import type * as XLSX from 'xlsx';
import { computeBudget } from '@/domain/budget';
import {
  computePayroll,
  WITHHOLDING_COMPONENTS,
  type PayrollDeduction,
  type WithholdingComponent,
} from '@/domain/payroll';
import { isEffectivelyZero, sub, type Money } from '@/domain/money';
import { parseRules, JURISDICTIONS, type Jurisdiction } from '@/domain/tax/rules';
import { Grid, cellMoney, ref } from '../sheet';
import type { BudgetImportPlan, PlannedBudgetLine, PlannedDeduction } from './analyzeBudget';

/** Read the app's compact, current-plan-only workbook. The older source layout has its own analyzer. */
export function analyzeCurrentBudget(wb: XLSX.WorkBook, plan: BudgetImportPlan): void {
  plan.recognizerVersion = 'personal-treasury-budget/1.0.0';
  const issue = (sheet: string, cell: string | null, message: string) => {
    plan.warnings.push({ severity: 'fatal', code: 'invalid_budget_export', sheet, cell, message });
    plan.fatal = true;
  };
  const sheet = (name: string) => {
    const ws = wb.Sheets[name];
    if (!ws) {
      issue(name, null, `Worksheet “${name}” is missing.`);
      return null;
    }
    return new Grid(name, ws);
  };
  const text = (g: Grid, r: number, c: number) => g.text(r, c)?.trim() ?? '';
  const amount = (g: Grid, r: number, c: number, required = false): Money | null => {
    const value = cellMoney(g.v(r, c));
    if (value === 'invalid' || (required && value === null)) {
      issue(g.name, ref(r, c), 'Enter a valid amount.');
      return null;
    }
    return value;
  };
  const integer = (g: Grid, r: number, c: number, required = false): number | null => {
    const raw = g.v(r, c);
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      if (required) issue(g.name, ref(r, c), 'Enter a whole number.');
      return null;
    }
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      issue(g.name, ref(r, c), 'Enter a whole number.');
      return null;
    }
    return value;
  };
  const boolean = (g: Grid, r: number, c: number) => {
    const value = g.v(r, c);
    if (value === true || value === 1 || String(value).toLowerCase() === 'true') return true;
    if (value === false || value === 0 || String(value).toLowerCase() === 'false') return false;
    issue(g.name, ref(r, c), 'Enter TRUE or FALSE.');
    return false;
  };
  const summary = sheet('Summary');
  const payroll = sheet('Payroll and tax');
  if (!summary || !payroll) return;
  plan.sheets.push({ name: 'Summary', role: 'current budget summary' });
  const label = text(summary, 1, 1);
  const effectiveFrom = text(summary, 2, 1) || null;
  const taxYear = integer(summary, 3, 1);
  const gross = amount(payroll, 1, 1, true);
  const filingStatus = text(payroll, 3, 1) || 'single';
  if (!label) issue('Summary', 'B2', 'Enter a budget name.');
  if (effectiveFrom && !/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFrom))
    issue('Summary', 'B3', 'Use YYYY-MM for the effective month.');
  if (text(payroll, 0, 0) !== 'Personal Treasury Payroll and tax v1')
    issue('Payroll and tax', 'A1', 'This is not a Personal Treasury payroll worksheet.');
  if (text(payroll, 2, 1) !== (taxYear === null ? '' : String(taxYear)))
    issue('Payroll and tax', 'B3', 'Tax years differ.');
  const withholdings: { component: WithholdingComponent; amount: Money; sourceRange: string }[] = [];
  for (let r = 7; r < 11; r++) {
    const component = text(payroll, r, 0) as WithholdingComponent;
    if (!WITHHOLDING_COMPONENTS.includes(component))
      issue('Payroll and tax', ref(r, 0), 'Unknown withholding component.');
    const value = amount(payroll, r, 1, true);
    if (value && WITHHOLDING_COMPONENTS.includes(component))
      withholdings.push({ component, amount: value, sourceRange: ref(r, 1) });
  }
  const deductions: PlannedDeduction[] = [];
  const taxHeader = Array.from({ length: payroll.rows }, (_, r) => r).find(
    (r) => text(payroll, r, 0) === 'Tax rules',
  );
  if (taxHeader === undefined) issue('Payroll and tax', null, 'Tax rules section is missing.');
  for (let r = 14; r < (taxHeader ?? payroll.rows); r++) {
    if (!text(payroll, r, 1)) continue;
    const timing = text(payroll, r, 2);
    const method = text(payroll, r, 3);
    if (timing !== 'pretax' && timing !== 'posttax')
      issue('Payroll and tax', ref(r, 2), 'Timing must be pretax or posttax.');
    if (method !== 'fixed' && method !== 'rate_of_gross_less_exclusion')
      issue('Payroll and tax', ref(r, 3), 'Unknown deduction method.');
    deductions.push({
      label: text(payroll, r, 1),
      position: integer(payroll, r, 0, true) ?? deductions.length,
      timing: timing as PlannedDeduction['timing'],
      method: method as PlannedDeduction['method'],
      monthlyAmount: amount(payroll, r, 4),
      rate: amount(payroll, r, 5),
      monthlyExclusion: amount(payroll, r, 6),
      reducesFederalIncome: boolean(payroll, r, 7),
      reducesCaIncome: boolean(payroll, r, 8),
      reducesFicaWages: boolean(payroll, r, 9),
      notes: text(payroll, r, 10) || null,
      sourceRange: ref(r, 0),
    });
  }
  if (taxHeader !== undefined) {
    for (let r = taxHeader + 2; r < payroll.rows; r++) {
      const jurisdiction = text(payroll, r, 0) as Jurisdiction;
      if (!jurisdiction) continue;
      if (!JURISDICTIONS.includes(jurisdiction)) {
        issue('Payroll and tax', ref(r, 0), 'Unknown tax jurisdiction.');
        continue;
      }
      try {
        plan.taxRuleSets.push({
          jurisdiction,
          taxYear: integer(payroll, r, 1, true) ?? 0,
          filingStatus: text(payroll, r, 2),
          ratesFromYear: integer(payroll, r, 3, true) ?? 0,
          provisional: boolean(payroll, r, 4),
          sourceNote: text(payroll, r, 5) || null,
          rules: parseRules(jurisdiction, JSON.parse(text(payroll, r, 6))),
        });
      } catch (err) {
        issue('Payroll and tax', ref(r, 6), `Invalid tax rules: ${(err as Error).message}`);
      }
    }
  }
  plan.sheets.push({ name: 'Payroll and tax', role: 'payroll and tax rules' });
  const lines: PlannedBudgetLine[] = [];
  const accountNames: Record<string, string> = {};
  const categories: NonNullable<BudgetImportPlan['categories']> = [];
  const seenTabs = new Set<string>();
  const seenCategories = new Set<string>();
  for (let r = 10; r < summary.rows; r++) {
    const name = text(summary, r, 0);
    const tab = text(summary, r, 1);
    if (!name && !tab) continue;
    if (!name || !tab) {
      issue('Summary', ref(r, 0), 'Each category needs a name and worksheet.');
      continue;
    }
    if (seenTabs.has(tab) || seenCategories.has(name.toLowerCase())) {
      issue('Summary', ref(r, 0), 'Category names and worksheet names must be unique.');
      continue;
    }
    seenTabs.add(tab);
    seenCategories.add(name.toLowerCase());
    const g = sheet(tab);
    if (!g) continue;
    plan.sheets.push({ name: tab, role: 'budget category' });
    if (text(g, 0, 0) !== 'Budget category' || text(g, 0, 1) !== name)
      issue(tab, 'A1', 'Category worksheet does not match Summary.');
    const key = name;
    categories.push({ key, name, description: text(g, 1, 1) || null });
    for (let lr = 4; lr < g.rows; lr++) {
      const item = text(g, lr, 1);
      if (!item) continue;
      const kind = text(g, lr, 2);
      if (kind !== 'amount' && kind !== 'residual')
        issue(tab, ref(lr, 2), 'Type must be amount or residual.');
      const accountName = text(g, lr, 4);
      const key = text(g, lr, 7) || accountName;
      if (!accountName || !key) issue(tab, ref(lr, 4), 'Choose a funding account.');
      if (accountNames[key] && accountNames[key] !== accountName)
        issue(tab, ref(lr, 4), 'One account key has conflicting names.');
      accountNames[key] = accountName;
      const monthlyAmount = amount(g, lr, 3, kind === 'amount');
      if (kind === 'residual' && monthlyAmount !== null)
        issue(tab, ref(lr, 3), 'Leave the monthly amount blank for a residual line.');
      lines.push({
        categoryKey: name,
        label: item,
        position: integer(g, lr, 0, true) ?? lines.length,
        kind: kind as PlannedBudgetLine['kind'],
        monthlyAmount,
        fundingCode: key,
        grossAmount: amount(g, lr, 5),
        notes: text(g, lr, 6) || null,
        sheet: tab,
        range: ref(lr, 0),
      });
    }
  }
  if (!categories.length) issue('Summary', 'A11', 'At least one category is required.');
  const version = {
    label,
    detailLevel: 'full' as const,
    status: 'active' as const,
    effectiveFrom,
    effectiveTo: null,
    grossMonthly: gross,
    taxYear,
    filingStatus,
    notes: null,
    deductions,
    withholdings,
    lines,
    summaryRows: [],
    sheet: 'Summary',
    range: 'A1',
  };
  plan.versions.push(version);
  plan.categories = categories;
  plan.accountNames = accountNames;
  plan.accountCodes = Object.keys(accountNames);
  plan.counts = {
    versions: 1,
    budgetLines: lines.length,
    deductions: deductions.length,
    taxRuleSets: plan.taxRuleSets.length,
    accounts: plan.accountCodes.length,
  };
  if (plan.fatal || gross === null) return;
  const computedPayroll = computePayroll({
    grossMonthly: gross,
    deductions: deductions.map((d, i) => ({ ...d, id: `d${i}` }) as PayrollDeduction),
    withholdings: Object.fromEntries(withholdings.map((w) => [w.component, w.amount])),
  });
  const computedBudget = computeBudget(
    computedPayroll.takeHome,
    lines.map((line, i) => ({
      id: `l${i}`,
      categoryId: line.categoryKey,
      label: line.label,
      position: line.position,
      kind: line.kind,
      monthlyAmount: line.monthlyAmount,
      fundingAccountId: line.fundingCode,
    })),
  );
  const control = (name: string, expected: Money | null, actual: Money) => {
    if (expected === null) return;
    const pass = isEffectivelyZero(sub(expected, actual));
    plan.controls.push({ group: 'Summary', name, expected, actual, pass });
    if (!pass)
      plan.warnings.push({
        severity: 'high',
        code: 'control_mismatch',
        sheet: 'Summary',
        cell: null,
        message: `${name} differs from the recalculated plan.`,
      });
  };
  control('Take-home monthly', amount(summary, 5, 1), computedPayroll.takeHome);
  control('Total allocated', amount(summary, 6, 1), computedBudget.totalAllocated);
  for (let r = 10; r < summary.rows; r++) {
    const name = text(summary, r, 0);
    if (!name) continue;
    control(
      name,
      amount(summary, r, 2),
      computedBudget.byCategory.find((x) => x.categoryId === name)?.amount ?? '0',
    );
  }
  for (const message of computedBudget.issues)
    plan.warnings.push({ severity: 'high', code: 'budget_issue', sheet: 'Summary', cell: null, message });
}
