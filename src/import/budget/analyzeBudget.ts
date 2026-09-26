import * as XLSX from 'xlsx';
import { computeBudget, type BudgetLine } from '@/domain/budget';
import {
  type Money,
  ZERO,
  cmp,
  dec,
  formatUSD,
  isEffectivelyZero,
  neg,
  normalize,
  sub,
} from '@/domain/money';
import { computePayroll, type PayrollDeduction, type WithholdingComponent } from '@/domain/payroll';
import { estimateTax } from '@/domain/tax/estimate';
import { bracketsFromIncrements, parseRules, type Jurisdiction, type TaxRuleSet } from '@/domain/tax/rules';
import type { ControlCheck, PlanWarning, Severity } from '../plan';
import { Grid, cellMoney, rangeRef, ref, sha256Hex, type CellValue } from '../sheet';
import { analyzeCurrentBudget } from './analyzeCurrentBudget';

export const BUDGET_RECOGNIZER_VERSION = 'personal-budget/1.0.0';

export const PETC_CATEGORY_DESCRIPTION = 'Recurring but non-regular charges, funded from PETC.';

/**
 * Explicit funding map for the audited workbook layout: which treasury account
 * funds each budget section. It is data (shown in the preview and editable per
 * line afterwards), not inference from category names, and it is verified by
 * reproducing the treasury allocations of the months that used the plan.
 */
export const FUNDING_MAP = {
  housing: 'HH',
  household: 'HH',
  householdExceptions: { clothing: 'CLTH' } as Record<string, string>,
  transportationNet: 'HH',
  lifestyleNet: 'HH',
  petc: 'PETC',
  longTermSavings: 'LTS',
  travel: 'TRV',
  discretionary: 'ENT',
} as const;

export const CATEGORIES: { key: string; name: string; description: string | null; planLabel: string }[] = [
  { key: 'housing', name: 'Housing and utilities', description: null, planLabel: 'housing and utilities' },
  {
    key: 'household',
    name: 'Household and personal',
    description: null,
    planLabel: 'household and personal',
  },
  { key: 'transportation', name: 'Transportation', description: null, planLabel: 'transportation' },
  { key: 'lifestyle', name: 'Lifestyle', description: 'Subscriptions and recurring', planLabel: 'lifestyle' },
  { key: 'petc', name: 'Pets etc.', description: PETC_CATEGORY_DESCRIPTION, planLabel: 'pets' },
  { key: 'lts', name: 'Long-term savings', description: null, planLabel: 'long-term savings' },
  { key: 'travel', name: 'Travel', description: null, planLabel: 'travel' },
  {
    key: 'discretionary',
    name: 'Discretionary',
    description: 'Remainder of take-home pay',
    planLabel: 'discretionary',
  },
];

/** Published figures used to label where rule values come from. */
const KNOWN_TABLES: { jurisdiction: Jurisdiction; year: number; thresholds: string[] }[] = [
  {
    jurisdiction: 'federal',
    year: 2026,
    thresholds: ['0', '12400', '50400', '105700', '201775', '256225', '640600'],
  },
  {
    jurisdiction: 'california',
    year: 2025,
    thresholds: ['0', '11079', '26264', '41452', '57542', '72724', '371479', '445771', '742953'],
  },
];

export interface PlannedDeduction extends Omit<PayrollDeduction, 'id'> {
  sourceRange: string | null;
}
export interface PlannedBudgetLine {
  categoryKey: string;
  label: string;
  position: number;
  kind: 'amount' | 'residual';
  monthlyAmount: Money | null;
  fundingCode: string;
  grossAmount: Money | null;
  notes: string | null;
  sheet: string;
  range: string | null;
}
export interface PlannedBudgetVersion {
  label: string;
  detailLevel: 'full' | 'summary';
  status: 'active' | 'archived';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  grossMonthly: Money | null;
  taxYear: number | null;
  filingStatus?: string;
  notes: string | null;
  deductions: PlannedDeduction[];
  withholdings: { component: WithholdingComponent; amount: Money; sourceRange: string | null }[];
  lines: PlannedBudgetLine[];
  summaryRows: {
    position: number;
    description: string;
    monthlyAmount: Money | null;
    sourceRange: string | null;
  }[];
  sheet: string;
  range: string | null;
}
export type PlannedRuleSet = Omit<TaxRuleSet, 'id'>;

export interface BudgetImportPlan {
  kind: 'budget';
  filename: string;
  hash: string;
  recognizerVersion: string;
  analyzedAt: string;
  sheets: { name: string; role: string }[];
  accountCodes: string[];
  /** Present for workbooks exported by this app; legacy imports use CATEGORIES. */
  categories?: { key: string; name: string; description: string | null }[];
  accountNames?: Record<string, string>;
  versions: PlannedBudgetVersion[];
  taxRuleSets: PlannedRuleSet[];
  controls: ControlCheck[];
  warnings: PlanWarning[];
  counts: Record<string, number>;
  fatal: boolean;
  duplicateOfRunIds: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Mar-27" → "2027-03". */
export function labelToMonth(label: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*[-\s']?(\d{2}|\d{4})$/.exec(label.trim());
  if (!m) return null;
  const i = MONTHS.indexOf(m[1].toLowerCase());
  if (i < 0) return null;
  const y = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${y}-${String(i + 1).padStart(2, '0')}`;
}
const monthBefore = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export interface AnalyzeBudgetOptions {
  committedHashes?: Map<string, string[]>;
  /** Latest budget-driven or imported treasury allocations to compare funding totals against. */
  treasuryReference?: { month: string; allocations: Record<string, Money> } | null;
}

export async function analyzeBudgetWorkbook(
  bytes: Uint8Array,
  filename: string,
  opts: AnalyzeBudgetOptions = {},
): Promise<BudgetImportPlan> {
  const warnings: PlanWarning[] = [];
  const warn = (
    severity: Severity,
    code: string,
    sheet: string | null,
    cell: string | null,
    message: string,
  ) => warnings.push({ severity, code, sheet, cell, message });
  const controls: ControlCheck[] = [];
  const control = (
    group: string,
    name: string,
    expected: string | null,
    actual: string,
    pass: boolean,
    detail?: string,
  ) => controls.push({ group, name, expected, actual, pass, detail });
  const hash = await sha256Hex(bytes);
  const plan: BudgetImportPlan = {
    kind: 'budget',
    filename,
    hash,
    recognizerVersion: BUDGET_RECOGNIZER_VERSION,
    analyzedAt: new Date().toISOString(),
    sheets: [],
    accountCodes: [],
    versions: [],
    taxRuleSets: [],
    controls,
    warnings,
    counts: {},
    fatal: false,
    duplicateOfRunIds: opts.committedHashes?.get(hash) ?? [],
  };
  if (plan.duplicateOfRunIds.length)
    warn(
      'high',
      'duplicate_import',
      null,
      null,
      'This budget workbook was already imported. Importing again adds another copy of each version.',
    );

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false });
  } catch (err) {
    warn(
      'fatal',
      'unreadable_workbook',
      null,
      null,
      `The file could not be read as an Excel workbook: ${(err as Error).message}`,
    );
    plan.fatal = true;
    return plan;
  }
  if (wb.Sheets.Summary?.A1?.v === 'Personal Treasury Budget v1') {
    analyzeCurrentBudget(wb, plan);
    return plan;
  }
  const grid = (name: string) => (wb.Sheets[name] ? new Grid(name, wb.Sheets[name]) : null);
  const required = ['Budget Plan', 'Payroll', 'Tax'];
  for (const n of wb.SheetNames) {
    const role =
      (
        {
          Overview: 'comparison',
          'Budget Plan': 'plan',
          Payroll: 'payroll',
          Tax: 'tax rules and withholding',
          Housing: 'lines',
          Transportation: 'lines',
          Lifestyle: 'lines',
          Petc: 'lines',
          'Budget History': 'history versions',
        } as Record<string, string>
      )[n] ?? 'ignored';
    plan.sheets.push({ name: n, role });
    if (role === 'ignored')
      warn('info', 'ignored_sheet', n, null, `Sheet “${n}” was not recognized and was left untouched.`);
  }
  for (const r of required) {
    if (!wb.Sheets[r]) {
      warn(
        'fatal',
        'missing_sheet',
        r,
        null,
        `Required sheet “${r}” is missing; this does not look like the Personal Budget workbook.`,
      );
      plan.fatal = true;
    }
  }
  if (plan.fatal) return plan;

  const planSheet = grid('Budget Plan')!;
  const payroll = grid('Payroll')!;
  const tax = grid('Tax')!;
  const findRow = (g: Grid, label: string, col = 0, from = 0) => {
    for (let r = from; r < g.rows; r++) if (g.label(r, col) === label.toLowerCase()) return r;
    return -1;
  };
  const money = (g: Grid, r: number, c: number, what: string): Money | null => {
    const m = cellMoney(g.v(r, c));
    if (m === 'invalid') {
      warn('high', 'invalid_amount', g.name, ref(r, c), `${what} is not a number.`);
      return null;
    }
    return m;
  };

  // ------------------------------------------------------------ version label
  const titleCell = planSheet.find((l) => /plan$/.test(l) && /\d/.test(l));
  const label = titleCell
    ? planSheet
        .text(titleCell.r, titleCell.c)!
        .replace(/\s*plan\s*$/i, '')
        .trim()
    : 'Imported plan';
  const effectiveFrom = labelToMonth(label);
  if (!effectiveFrom)
    warn(
      'warning',
      'unknown_plan_date',
      planSheet.name,
      titleCell ? ref(titleCell.r, titleCell.c) : null,
      `Could not read a month from “${label}”; set the effective month after import.`,
    );

  // ------------------------------------------------------------ payroll
  const grossRow = findRow(payroll, 'Gross pay');
  const gross = grossRow >= 0 ? money(payroll, grossRow, 1, 'Gross pay') : null;
  if (!gross) {
    warn('fatal', 'missing_gross', payroll.name, null, 'Gross pay was not found on the Payroll sheet.');
    plan.fatal = true;
    return plan;
  }
  const stipendRow = findRow(payroll, 'Stipend');
  if (stipendRow >= 0) {
    const st = money(payroll, stipendRow, 1, 'Stipend');
    if (st && !isEffectivelyZero(st))
      warn(
        'warning',
        'stipend_ignored',
        payroll.name,
        ref(stipendRow, 1),
        `Stipend ${formatUSD(st)} was not imported (stipend has ended).`,
      );
    else
      warn(
        'info',
        'stipend_ignored',
        payroll.name,
        ref(stipendRow, 1),
        'Stipend row (0) not imported; stipend has ended.',
      );
  }
  const rateCell = payroll.find((l) => l === 'rate');
  const exclCell = payroll.find((l) => l === 'monthly exclusion');
  const pensionRate = rateCell ? cellMoney(payroll.v(rateCell.r, rateCell.c + 1)) : null;
  const pensionExcl = exclCell ? cellMoney(payroll.v(exclCell.r, exclCell.c + 1)) : null;

  const deductions: PlannedDeduction[] = [];
  const section = (startLabel: string, endLabel: string, timing: 'pretax' | 'posttax') => {
    const start = findRow(payroll, startLabel);
    const end = findRow(payroll, endLabel, 0, start + 1);
    if (start < 0 || end < 0) {
      warn('high', 'missing_section', payroll.name, null, `Payroll section “${startLabel}” was not found.`);
      return;
    }
    for (let r = start + 1; r < end; r++) {
      const text = payroll.text(r, 0);
      if (!text || /subtotal/i.test(text)) continue;
      const cell = payroll.cell(r, 1);
      const isRetirement = /pension|457|403|401/i.test(text);
      // Workbook treatment (Tax sheet): health items reduce federal, CA and FICA wages;
      // retirement pick-ups reduce federal and CA income but remain FICA wages; post-tax items reduce nothing.
      const flags =
        timing === 'posttax'
          ? [false, false, false]
          : isRetirement
            ? [true, true, false]
            : [true, true, true];
      const formula = cell?.f ?? '';
      const usesRate = /\$F\$5/.test(formula) && /\$F\$6/.test(formula);
      const amt = money(payroll, r, 1, text);
      deductions.push({
        label: text.trim(),
        position: deductions.length,
        timing,
        method: usesRate ? 'rate_of_gross_less_exclusion' : 'fixed',
        monthlyAmount: usesRate ? null : amt === null ? ZERO : neg(amt),
        rate: usesRate && pensionRate && pensionRate !== 'invalid' ? pensionRate : null,
        monthlyExclusion: usesRate && pensionExcl && pensionExcl !== 'invalid' ? pensionExcl : null,
        reducesFederalIncome: flags[0],
        reducesCaIncome: flags[1],
        reducesFicaWages: flags[2],
        notes: usesRate ? `Workbook formula: ${formula}` : null,
        sourceRange: ref(r, 1),
      });
    }
  };
  section('Pretax deductions', 'Pension (regular)', 'pretax');
  // Pension rows follow the health block within the pretax section.
  const pensionStart = findRow(payroll, 'Pension (regular)');
  const postStart = findRow(payroll, 'Post-tax deductions');
  for (let r = pensionStart; r >= 0 && r < postStart; r++) {
    const text = payroll.text(r, 0);
    if (!text || /subtotal/i.test(text)) continue;
    const before = deductions.length;
    // Reuse the section parser logic for a single row.
    const cell = payroll.cell(r, 1);
    const formula = cell?.f ?? '';
    const usesRate = /\$F\$5/.test(formula) && /\$F\$6/.test(formula);
    const amt = money(payroll, r, 1, text);
    deductions.push({
      label: text.trim(),
      position: before,
      timing: 'pretax',
      method: usesRate ? 'rate_of_gross_less_exclusion' : 'fixed',
      monthlyAmount: usesRate ? null : amt === null ? ZERO : neg(amt),
      rate: usesRate && pensionRate && pensionRate !== 'invalid' ? pensionRate : null,
      monthlyExclusion: usesRate && pensionExcl && pensionExcl !== 'invalid' ? pensionExcl : null,
      reducesFederalIncome: true,
      reducesCaIncome: true,
      reducesFicaWages: false,
      notes: usesRate ? `Workbook formula: ${formula}` : null,
      sourceRange: ref(r, 1),
    });
  }
  // 457(b) appears only on the Tax sheet.
  const r457 = findRow(tax, '457(b)');
  if (r457 >= 0 && !deductions.some((d) => /457/.test(d.label))) {
    // The Tax sheet states it annually; store the monthly amount.
    const annual = money(tax, r457, 1, '457(b)');
    deductions.push({
      label: '457(b)',
      position: deductions.length,
      timing: 'pretax',
      method: 'fixed',
      monthlyAmount: annual ? normalize(dec(neg(annual)).div(12)) : ZERO,
      rate: null,
      monthlyExclusion: null,
      reducesFederalIncome: true,
      reducesCaIncome: true,
      reducesFicaWages: false,
      notes: 'From the Tax sheet (annual 0); kept so the deduction and its tax treatment exist.',
      sourceRange: ref(r457, 1),
    });
  }
  section('Post-tax deductions', 'Tax withholding', 'posttax');

  // Withholding: hard inputs from the Tax sheet's withholding table.
  const whTitle = tax.find((l) => l === 'withholding');
  const withholdings: PlannedBudgetVersion['withholdings'] = [];
  if (!whTitle) {
    warn('fatal', 'missing_withholding', tax.name, null, 'The Tax sheet has no Withholding table.');
    plan.fatal = true;
  } else {
    const c = whTitle.c;
    for (let r = whTitle.r + 2; r < tax.rows; r++) {
      const comp = tax.label(r, c);
      if (!comp || comp === 'total') break;
      const monthlyCol = c + 2;
      const cell = tax.cell(r, monthlyCol);
      const amt = money(tax, r, monthlyCol, `${comp} withholding`) ?? ZERO;
      if (comp.startsWith('federal'))
        withholdings.push({ component: 'federal', amount: amt, sourceRange: ref(r, monthlyCol) });
      else if (comp.startsWith('state'))
        withholdings.push({ component: 'california', amount: amt, sourceRange: ref(r, monthlyCol) });
      else if (comp.startsWith('employment')) {
        const parts = /^\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*$/.exec(cell?.f ?? '');
        if (parts) {
          withholdings.push({
            component: 'social_security',
            amount: normalize(parts[1]),
            sourceRange: ref(r, monthlyCol),
          });
          withholdings.push({
            component: 'medicare',
            amount: normalize(parts[2]),
            sourceRange: ref(r, monthlyCol),
          });
          warn(
            'info',
            'employment_split',
            tax.name,
            ref(r, monthlyCol),
            `Employment withholding ${cell?.f} split into Social Security ${parts[1]} and Medicare ${parts[2]}.`,
          );
        } else {
          warn(
            'high',
            'employment_unsplit',
            tax.name,
            ref(r, monthlyCol),
            'Employment withholding is not in the form SS+Medicare; enter the two amounts after import.',
          );
          withholdings.push({ component: 'social_security', amount: amt, sourceRange: ref(r, monthlyCol) });
        }
      } else if (comp.includes('sdi')) {
        if (!isEffectivelyZero(amt))
          warn(
            'warning',
            'sdi_ignored',
            tax.name,
            ref(r, monthlyCol),
            `CA SDI withholding ${formatUSD(amt)} was not imported (not subject to SDI).`,
          );
        else
          warn(
            'info',
            'sdi_ignored',
            tax.name,
            ref(r, monthlyCol),
            'CA SDI row not imported (not subject to SDI).',
          );
      }
    }
  }

  // ------------------------------------------------------------ budget lines
  const lines: PlannedBudgetLine[] = [];
  const add = (l: Omit<PlannedBudgetLine, 'position'>) => lines.push({ ...l, position: lines.length });
  const itemTable = (
    sheetName: string,
    labelCol: number,
    amountCol: number,
    categoryKey: string,
    funding: (item: string) => string,
  ) => {
    const g = grid(sheetName);
    if (!g) {
      warn(
        'high',
        'missing_sheet',
        sheetName,
        null,
        `Sheet “${sheetName}” is missing; its lines were not imported.`,
      );
      return;
    }
    const header = (() => {
      for (let r = 0; r < g.rows; r++) if (g.label(r, labelCol) === 'item') return r;
      return -1;
    })();
    for (let r = header + 1; header >= 0 && r < g.rows; r++) {
      const item = g.text(r, labelCol);
      if (!item) continue;
      if (item.trim().toLowerCase() === 'total') break;
      const amt = money(g, r, amountCol, item) ?? ZERO;
      const f = g.cell(r, amountCol)?.f;
      add({
        categoryKey,
        label: item.trim(),
        kind: 'amount',
        monthlyAmount: amt,
        fundingCode: funding(item.trim()),
        grossAmount: null,
        notes: f ? `Workbook formula: =${f}` : null,
        sheet: sheetName,
        range: ref(r, amountCol),
      });
    }
  };
  itemTable('Housing', 0, 1, 'housing', () => FUNDING_MAP.housing);
  itemTable(
    'Housing',
    3,
    4,
    'household',
    (item) => FUNDING_MAP.householdExceptions[item.toLowerCase()] ?? FUNDING_MAP.household,
  );

  const splitTable = (sheetName: string, categoryKey: string, netFunding: string) => {
    const g = grid(sheetName);
    if (!g) {
      warn(
        'high',
        'missing_sheet',
        sheetName,
        null,
        `Sheet “${sheetName}” is missing; its lines were not imported.`,
      );
      return;
    }
    const h = g.findHeader(['Item', 'Gross expense']);
    if (!h) return;
    const allocCol = [...Array(g.cols).keys()].find((c) => /^allocated to pet/.test(g.label(h.row, c)));
    const netCol = [...Array(g.cols).keys()].find((c) => /^net /.test(g.label(h.row, c)));
    const grossCol = h.cols.get('gross expense')!;
    for (let r = h.row + 1; r < g.rows; r++) {
      const item = g.text(r, 0);
      if (!item) continue;
      if (item.trim().toLowerCase() === 'total') break;
      const grossAmt = money(g, r, grossCol, item) ?? ZERO;
      const alloc =
        allocCol !== undefined ? (money(g, r, allocCol, `${item} allocated to PETC`) ?? ZERO) : ZERO;
      const net =
        netCol !== undefined
          ? (money(g, r, netCol, `${item} net`) ?? sub(grossAmt, alloc))
          : sub(grossAmt, alloc);
      const split = !isEffectivelyZero(alloc);
      if (!split || !isEffectivelyZero(net)) {
        add({
          categoryKey,
          label: item.trim(),
          kind: 'amount',
          monthlyAmount: net,
          fundingCode: netFunding,
          grossAmount: split ? grossAmt : null,
          notes: split ? `Gross ${formatUSD(grossAmt)}; ${formatUSD(alloc)} funded from PETC` : null,
          sheet: sheetName,
          range: ref(r, netCol ?? grossCol),
        });
      }
      if (split) {
        add({
          categoryKey: 'petc',
          label: item.trim(),
          kind: 'amount',
          monthlyAmount: alloc,
          fundingCode: FUNDING_MAP.petc,
          grossAmount: grossAmt,
          notes: `Listed on the ${sheetName} sheet; allocated to PETC`,
          sheet: sheetName,
          range: ref(r, allocCol!),
        });
      }
    }
  };
  splitTable('Transportation', 'transportation', FUNDING_MAP.transportationNet);
  splitTable('Lifestyle', 'lifestyle', FUNDING_MAP.lifestyleNet);

  const petc = grid('Petc');
  if (petc) {
    const h = petc.findHeader(['Item', 'Monthly expense']);
    for (let r = (h?.row ?? petc.rows) + 1; r < petc.rows; r++) {
      const item = petc.text(r, 0);
      if (!item) continue;
      if (item.trim().toLowerCase() === 'total') break;
      const f = petc.cell(r, 1)?.f ?? '';
      if (f.includes('!')) {
        warn(
          'info',
          'petc_reference',
          petc.name,
          ref(r, 1),
          `“${item}” (=${f}) is the PETC share of a line on another sheet; imported there, not twice.`,
        );
        continue;
      }
      add({
        categoryKey: 'petc',
        label: item.trim(),
        kind: 'amount',
        monthlyAmount: money(petc, r, 1, item) ?? ZERO,
        fundingCode: FUNDING_MAP.petc,
        grossAmount: null,
        notes: null,
        sheet: petc.name,
        range: ref(r, 1),
      });
    }
  } else warn('high', 'missing_sheet', 'Petc', null, 'Sheet “Petc” is missing; its lines were not imported.');

  const planRow = (text: string) => findRow(planSheet, text);
  const fixedPlanLine = (text: string, categoryKey: string, fundingCode: string) => {
    const r = planRow(text);
    if (r < 0)
      return warn(
        'high',
        'missing_plan_row',
        planSheet.name,
        null,
        `Budget Plan row “${text}” was not found.`,
      );
    const amt = money(planSheet, r, 1, text) ?? ZERO;
    add({
      categoryKey,
      label: text,
      kind: 'amount',
      monthlyAmount: neg(amt),
      fundingCode,
      grossAmount: null,
      notes: null,
      sheet: planSheet.name,
      range: ref(r, 1),
    });
  };
  fixedPlanLine('Long-term savings', 'lts', FUNDING_MAP.longTermSavings);
  fixedPlanLine('Travel', 'travel', FUNDING_MAP.travel);
  const discRow = planRow('Discretionary');
  add({
    categoryKey: 'discretionary',
    label: 'Discretionary',
    kind: 'residual',
    monthlyAmount: null,
    fundingCode: FUNDING_MAP.discretionary,
    grossAmount: null,
    notes: 'Take-home pay minus every other line',
    sheet: planSheet.name,
    range: discRow >= 0 ? ref(discRow, 1) : null,
  });

  // ------------------------------------------------------------ tax rules
  const taxYearCell = tax.find((l) => l === 'tax year');
  const taxYear = taxYearCell ? Number(tax.v(taxYearCell.r, taxYearCell.c + 1)) : NaN;
  // SUMPRODUCT((t>{thresholds})*(t-{thresholds})*{increments}): thresholds first, increments last.
  const arrays = (f: string) => {
    const groups = [...f.matchAll(/\{([^}]*)\}/g)].map((m) =>
      m[1].split(',').map((x) => normalize(x.trim())),
    );
    return groups.length >= 2 ? [groups[0], groups[groups.length - 1]] : [];
  };
  const known = (j: Jurisdiction, th: string[]) =>
    KNOWN_TABLES.find((k) => k.jurisdiction === j && k.thresholds.join() === th.join())?.year ?? null;
  if (!Number.isInteger(taxYear))
    warn('high', 'missing_tax_year', tax.name, null, 'Tax year was not found; tax rules were not imported.');
  else {
    const rowOf = (label: string) => findRow(tax, label, 3);
    const fedRow = rowOf('Federal tax');
    const caRow = rowOf('State tax');
    const empRow = rowOf('Employment tax');
    const stdRow = findRow(tax, 'Standard deduction');
    const tryRules = (j: Jurisdiction, build: () => unknown, cell: string, fromYear: number | null) => {
      try {
        const rules = parseRules(j, build());
        const ratesFromYear = fromYear ?? taxYear;
        plan.taxRuleSets.push({
          taxYear,
          jurisdiction: j,
          filingStatus: 'single',
          ratesFromYear,
          provisional: ratesFromYear !== taxYear,
          rules,
          sourceNote:
            fromYear === null
              ? `Read from ${tax.name}!${cell}; figures not matched to a published table — verify.`
              : ratesFromYear !== taxYear
                ? `Read from ${tax.name}!${cell}. These are ${ratesFromYear} figures used for ${taxYear} until ${taxYear} values are entered.`
                : `Read from ${tax.name}!${cell}; matches published ${ratesFromYear} figures.`,
        });
        if (fromYear === null)
          warn(
            'warning',
            'unverified_tax_rules',
            tax.name,
            cell,
            `${j} rules were read from the workbook but do not match a known published table.`,
          );
        if (fromYear !== null && fromYear !== taxYear)
          warn(
            'warning',
            'provisional_tax_rules',
            tax.name,
            cell,
            `${j === 'california' ? 'California' : j} rules for ${taxYear} use ${fromYear} figures (provisional).`,
          );
      } catch (err) {
        warn(
          'high',
          'tax_rules_unreadable',
          tax.name,
          cell,
          `Could not read ${j} rules: ${(err as Error).message}. Enter them in Tax rules.`,
        );
      }
    };
    if (fedRow >= 0) {
      const f = tax.cell(fedRow, 4)?.f ?? '';
      const [th, inc] = arrays(f);
      const std = stdRow >= 0 ? cellMoney(tax.v(stdRow, 1)) : null;
      tryRules(
        'federal',
        () => ({
          brackets: bracketsFromIncrements(th, inc),
          standardDeduction: std && std !== 'invalid' ? neg(std) : undefined,
          credits: [],
        }),
        ref(fedRow, 4),
        th ? known('federal', th) : null,
      );
    }
    if (caRow >= 0) {
      const f = tax.cell(caRow, 4)?.f ?? '';
      const [th, inc] = arrays(f);
      const std = /SUM\([^)]*\)-(\d+(?:\.\d+)?)/.exec(f)?.[1];
      const credit = /\)-(\d+(?:\.\d+)?)\)\),0\)\s*$/.exec(f)?.[1];
      tryRules(
        'california',
        () => ({
          brackets: bracketsFromIncrements(th, inc),
          standardDeduction: std,
          exemptionCredit: credit,
        }),
        ref(caRow, 4),
        th ? known('california', th) : null,
      );
    }
    if (empRow >= 0) {
      const f = tax.cell(empRow, 4)?.f ?? '';
      const ss = /,(\d+(?:\.\d+)?)\)\*(\d+(?:\.\d+)?)%/.exec(f);
      const med = /\)\*(\d+(?:\.\d+)?)%\+MAX\(0,[^)]*-(\d+(?:\.\d+)?)\)\*(\d+(?:\.\d+)?)%/.exec(f);
      const pct = (p: string) => normalize(dec(p).div(100));
      tryRules(
        'fica',
        () => ({
          socialSecurityRate: ss && pct(ss[2]),
          socialSecurityWageBase: ss?.[1],
          medicareRate: med && pct(med[1]),
          additionalMedicareThreshold: med?.[2],
          additionalMedicareRate: med && pct(med[3]),
        }),
        ref(empRow, 4),
        ss?.[1] === '184500' && taxYear === 2026 ? 2026 : null,
      );
    }
  }

  const current: PlannedBudgetVersion = {
    label,
    detailLevel: 'full',
    status: 'active',
    effectiveFrom,
    effectiveTo: null,
    grossMonthly: gross,
    taxYear: Number.isInteger(taxYear) ? taxYear : null,
    notes: `Imported from ${filename}`,
    deductions,
    withholdings,
    lines,
    summaryRows: [],
    sheet: planSheet.name,
    range: titleCell ? ref(titleCell.r, titleCell.c) : null,
  };

  // ------------------------------------------------------------ history versions
  const hist = grid('Budget History');
  if (hist) {
    const h = hist.findHeader(['Description']);
    if (h) {
      const noteText = [...Array(h.row).keys()]
        .map((r) => hist.text(r, 0))
        .filter((t): t is string => !!t && !/^budget history$|^monthly comparison$/i.test(t));
      const cols = [...Array(hist.cols).keys()].filter(
        (c) => c !== h.cols.get('description') && labelToMonth(hist.text(h.row, c) ?? '') !== null,
      );
      const found: PlannedBudgetVersion[] = [];
      for (const c of cols) {
        const colLabel = hist.text(h.row, c)!.trim();
        if (colLabel === label) {
          // The detailed current plan already represents this column; verify they agree.
          continue;
        }
        const rows: PlannedBudgetVersion['summaryRows'] = [];
        for (let r = h.row + 1; r < hist.rows; r++) {
          const d = hist.text(r, h.cols.get('description')!);
          if (!d) continue;
          const v = cellMoney(hist.v(r, c) as CellValue);
          rows.push({
            position: rows.length,
            description: d,
            monthlyAmount: v === 'invalid' ? null : v,
            sourceRange: ref(r, c),
          });
        }
        const notes = noteText.filter((n) => n.includes(colLabel));
        found.push({
          label: colLabel,
          detailLevel: 'summary',
          status: 'archived',
          effectiveFrom: labelToMonth(colLabel),
          effectiveTo: null,
          grossMonthly: null,
          taxYear: null,
          notes: [`Summary imported from ${hist.name}; not an item-level plan.`, ...notes].join(' '),
          deductions: [],
          withholdings: [],
          lines: [],
          summaryRows: rows,
          sheet: hist.name,
          range: rangeRef(h.row, c, hist.rows - 1, c),
        });
      }
      const all = [...found, current]
        .filter((v) => v.effectiveFrom)
        .sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!));
      all.forEach((v, i) => {
        if (v.detailLevel === 'summary' && all[i + 1]) v.effectiveTo = monthBefore(all[i + 1].effectiveFrom!);
      });
      plan.versions.push(...found);
      // Compare with the earliest historical version, the one furthest from the current plan.
      const gross0 = all
        .find((v) => v.detailLevel === 'summary')
        ?.summaryRows.find((r) => /gross/i.test(r.description))?.monthlyAmount;
      if (gross0 && cmp(gross0, gross) !== 0)
        warn(
          'info',
          'historical_gross',
          hist.name,
          null,
          `Historical version gross pay ${formatUSD(gross0)} is kept as history; the current plan uses ${formatUSD(gross)}.`,
        );
    }
  }
  plan.versions.push(current);

  // ------------------------------------------------------------ controls
  const codeIds = (code: string) => code; // codes act as account ids for planning
  const payrollResult = computePayroll({
    grossMonthly: gross,
    deductions: deductions.map((d, i) => ({ ...d, id: `d${i}` })),
    withholdings: Object.fromEntries(withholdings.map((w) => [w.component, w.amount])),
  });
  const budgetLines: BudgetLine[] = lines.map((l, i) => ({
    id: `l${i}`,
    categoryId: l.categoryKey,
    label: l.label,
    position: l.position,
    kind: l.kind,
    monthlyAmount: l.monthlyAmount,
    fundingAccountId: codeIds(l.fundingCode),
  }));
  const budget = computeBudget(payrollResult.takeHome, budgetLines);
  const cmpMoney = (
    group: string,
    name: string,
    g: Grid,
    r: number,
    c: number,
    actual: Money,
    negate = false,
  ) => {
    if (r < 0) return;
    const m = cellMoney(g.v(r, c));
    if (m === null || m === 'invalid') return;
    const exp = negate ? neg(m) : m;
    control(group, name, exp, actual, isEffectivelyZero(sub(exp, actual)));
  };
  cmpMoney(
    'Payroll',
    'Pension (regular)',
    payroll,
    pensionStart,
    1,
    payrollResult.deductions.find((d) => d.method === 'rate_of_gross_less_exclusion')?.amount ?? ZERO,
    true,
  );
  cmpMoney('Payroll', 'Take-home pay', payroll, findRow(payroll, 'Take-home pay'), 1, payrollResult.takeHome);
  cmpMoney(
    'Payroll',
    'Tax withholding',
    payroll,
    findRow(payroll, 'Tax withholding'),
    1,
    payrollResult.withholdingTotal,
    true,
  );
  cmpMoney('Budget Plan', 'Take-home pay', planSheet, planRow('Take-home pay'), 1, payrollResult.takeHome);
  for (const cat of CATEGORIES) {
    const r = findRow(planSheet, cat.planLabel, 0, findRow(planSheet, 'Monthly allocations'));
    const actual = budget.byCategory.find((b) => b.categoryId === cat.key)?.amount ?? ZERO;
    cmpMoney('Budget Plan', cat.name, planSheet, r, 1, actual, cat.key !== 'discretionary');
  }
  const diffRow = findRow(planSheet, 'Allocation difference');
  cmpMoney('Budget Plan', 'Allocation difference', planSheet, diffRow, 1, budget.unallocated);
  const ov = grid('Overview');
  if (ov) {
    cmpMoney('Overview', 'Gross pay', ov, findRow(ov, 'Gross pay'), 1, gross);
    cmpMoney('Overview', 'Take-home pay', ov, findRow(ov, 'Take-home pay'), 1, payrollResult.takeHome);
    cmpMoney(
      'Overview',
      'Discretionary',
      ov,
      findRow(ov, 'Discretionary'),
      1,
      budget.byCategory.find((b) => b.categoryId === 'discretionary')?.amount ?? ZERO,
    );
  }
  for (const i of budget.issues) warn('high', 'budget_issue', planSheet.name, null, i);

  if (plan.taxRuleSets.length === 3 && Number.isInteger(taxYear)) {
    const est = estimateTax(
      payrollResult,
      taxYear,
      plan.taxRuleSets.map((r, i) => ({ ...r, id: `t${i}` })),
    );
    const tc = (label: string, actual: Money) =>
      cmpMoney('Tax estimate', label, tax, findRow(tax, label, 3), 4, actual);
    tc('Federal tax', est.components[0].liabilityRounded);
    tc('State tax', est.components[1].liabilityRounded);
    tc('Employment tax', est.employment.liabilityRounded);
    const totalRow = findRow(tax, 'Total', 3);
    cmpMoney('Tax estimate', 'Total liability', tax, totalRow, 4, est.total.liabilityRounded);
    const whTotal = whTitle ? findRow(tax, 'Total', whTitle.c, whTitle.r) : -1;
    cmpMoney('Tax estimate', 'Total withholding (annual)', tax, whTotal, 4, est.total.withheld);
    control(
      'Tax estimate',
      'Projected underpayment (+) / overpayment (−)',
      null,
      est.total.difference,
      true,
      'Liability minus actual withholding; informational',
    );
  }

  if (opts.treasuryReference) {
    const ref0 = opts.treasuryReference;
    const problems: string[] = [];
    const codes = new Set([
      ...Object.keys(ref0.allocations),
      ...budget.byFundingAccount.map((f) => f.accountId),
    ]);
    for (const code of codes) {
      const a = budget.byFundingAccount.find((f) => f.accountId === code)?.amount ?? ZERO;
      const t = ref0.allocations[code] ?? ZERO;
      if (!isEffectivelyZero(sub(a, t)))
        problems.push(`${code}: budget ${formatUSD(a)} vs treasury ${formatUSD(t)}`);
    }
    control(
      'Treasury',
      `Funding by account vs treasury ${ref0.month}`,
      'treasury allocations',
      'budget funding',
      problems.length === 0,
      problems.join('; ') || undefined,
    );
    if (problems.length)
      warn(
        'warning',
        'treasury_funding_difference',
        null,
        null,
        `Budget funding differs from treasury ${ref0.month}: ${problems.join('; ')}`,
      );
  }

  for (const c of controls)
    if (!c.pass)
      warn(
        'high',
        'control_mismatch',
        null,
        null,
        `${c.group} · ${c.name}: workbook ${c.expected ?? '—'}, app ${c.actual}${c.detail ? ` (${c.detail})` : ''}`,
      );
  plan.accountCodes = [...new Set(lines.map((l) => l.fundingCode))];
  plan.counts = {
    versions: plan.versions.length,
    budgetLines: lines.length,
    deductions: deductions.length,
    withholdings: withholdings.length,
    taxRuleSets: plan.taxRuleSets.length,
    warnings: warnings.length,
  };
  if (warnings.some((w) => w.severity === 'fatal')) plan.fatal = true;
  return plan;
}
