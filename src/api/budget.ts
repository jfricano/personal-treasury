import { z } from 'zod';
import { computeBudget, type BudgetLine, type BudgetResult } from '@/domain/budget';
import { isMoney, normalize } from '@/domain/money';
import {
  computePayroll,
  WITHHOLDING_COMPONENTS,
  type PayrollDeduction,
  type PayrollResult,
  type WithholdingComponent,
} from '@/domain/payroll';
import { estimateTax, MissingTaxRulesError, type TaxEstimate } from '@/domain/tax/estimate';
import { JURISDICTIONS, parseRules, type Jurisdiction, type TaxRuleSet } from '@/domain/tax/rules';
import { BudgetRepositories, type BudgetVersion, type StoredBudgetLine } from '@/db/budgetRepositories';
import { TreasuryError } from './errors';
import type { Treasury } from './treasury';
import { CATEGORIES, type BudgetImportPlan } from '@/import/budget/analyzeBudget';

const uuid = () => crypto.randomUUID();
const money = z.string().refine(isMoney, 'Enter a decimal amount');
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new TreasuryError(r.error.issues[0]?.message ?? 'Invalid input', 'validation');
  return r.data;
}

const DeductionInput = z.object({
  label: z.string().trim().min(1, 'Label is required'),
  timing: z.enum(['pretax', 'posttax']),
  method: z.enum(['fixed', 'rate_of_gross_less_exclusion']),
  monthlyAmount: money.nullish(),
  rate: money.nullish(),
  monthlyExclusion: money.nullish(),
  reducesFederalIncome: z.boolean(),
  reducesCaIncome: z.boolean(),
  reducesFicaWages: z.boolean(),
  notes: z.string().nullish(),
});

const LineInput = z
  .object({
    categoryId: z.string().min(1, 'Choose a category'),
    label: z.string().trim().min(1, 'Label is required'),
    kind: z.enum(['amount', 'residual']),
    monthlyAmount: money.nullish(),
    fundingAccountId: z
      .string()
      .nullish()
      .refine((v) => !!v, 'Choose the treasury account that funds this line'),
    grossAmount: money.nullish(),
    notes: z.string().nullish(),
  })
  .refine((l) => l.kind === 'residual' || (l.monthlyAmount ?? '') !== '', {
    message: 'Amount is required',
    path: ['monthlyAmount'],
  });

export interface VersionSummary {
  version: BudgetVersion;
  takeHome: string | null;
  monthsUsed: { id: string; month: string; closedAt: string | null }[];
  editable: boolean;
}

export interface VersionView extends VersionSummary {
  deductions: PayrollDeduction[];
  withholdings: Partial<Record<WithholdingComponent, string>>;
  lines: StoredBudgetLine[];
  summaryRows: ReturnType<BudgetRepositories['listSummaryRows']>;
  payroll: PayrollResult | null;
  budget: BudgetResult | null;
  tax: TaxEstimate | null;
  taxError: string | null;
}

/**
 * Budget plans, payroll and tax rules. Budget data never writes journal
 * entries; it reaches the treasury only through Treasury.createMonth /
 * refreshMonthFromBudget, both explicit user actions.
 */
export class BudgetService {
  readonly repos: BudgetRepositories;
  constructor(private readonly t: Treasury) {
    this.repos = new BudgetRepositories(t.db);
  }

  // ------------------------------------------------------------ reads
  categories() {
    return this.repos.listCategories();
  }

  isEditable(v: BudgetVersion): boolean {
    return v.detailLevel === 'full' && !v.lockedAt && v.status !== 'archived';
  }

  compute(versionId: string): { payroll: PayrollResult; budget: BudgetResult } {
    const v = this.repos.getVersion(versionId);
    if (!v) throw new TreasuryError('Budget version not found', 'not_found');
    if (v.detailLevel !== 'full' || v.grossMonthly === null) {
      throw new TreasuryError(
        `${v.label} is a summary-only historical version and cannot drive a month.`,
        'summary_version',
      );
    }
    const payroll = computePayroll({
      grossMonthly: v.grossMonthly,
      deductions: this.repos.listDeductions(v.id),
      withholdings: this.repos.listWithholdings(v.id),
    });
    return { payroll, budget: computeBudget(payroll.takeHome, this.repos.listLines(v.id)) };
  }

  versions(): VersionSummary[] {
    return this.repos.listVersions().map((version) => {
      const takeHome =
        version.detailLevel === 'full'
          ? this.compute(version.id).payroll.takeHome
          : (this.repos.listSummaryRows(version.id).find((r) => /take-home/i.test(r.description))
              ?.monthlyAmount ?? null);
      return {
        version,
        takeHome,
        monthsUsed: this.repos.monthsUsingVersion(version.id),
        editable: this.isEditable(version),
      };
    });
  }

  activeVersion() {
    return this.repos.getActiveVersion();
  }

  versionView(id: string): VersionView {
    const version = this.repos.getVersion(id);
    if (!version) throw new TreasuryError('Budget version not found', 'not_found');
    const base = {
      version,
      monthsUsed: this.repos.monthsUsingVersion(id),
      editable: this.isEditable(version),
      deductions: this.repos.listDeductions(id),
      withholdings: this.repos.listWithholdings(id),
      lines: this.repos.listLines(id),
      summaryRows: this.repos.listSummaryRows(id),
    };
    if (version.detailLevel !== 'full') {
      const takeHome = base.summaryRows.find((r) => /take-home/i.test(r.description))?.monthlyAmount ?? null;
      return { ...base, takeHome, payroll: null, budget: null, tax: null, taxError: null };
    }
    const { payroll, budget } = this.compute(id);
    let tax: TaxEstimate | null = null;
    let taxError: string | null = null;
    try {
      tax = estimateTax(
        payroll,
        version.taxYear ?? new Date().getFullYear(),
        this.repos.listRuleSets().filter((r) => r.filingStatus === version.filingStatus),
      );
    } catch (err) {
      if (err instanceof MissingTaxRulesError) taxError = err.message;
      else throw err;
    }
    return { ...base, takeHome: payroll.takeHome, payroll, budget, tax, taxError };
  }

  // ------------------------------------------------------------ versions
  private editableVersion(id: string) {
    const v = this.repos.getVersion(id);
    if (!v) throw new TreasuryError('Budget version not found', 'not_found');
    if (v.detailLevel !== 'full')
      throw new TreasuryError('Summary-only historical versions are read-only.', 'read_only');
    if (v.lockedAt) {
      throw new TreasuryError(
        `${v.label} is locked because treasury months use it. Duplicate it to make changes.`,
        'locked',
      );
    }
    if (v.status === 'archived')
      throw new TreasuryError(`${v.label} is archived. Duplicate it to make changes.`, 'read_only');
    return v;
  }

  createDraft(label: string): string {
    const name = label.trim() || 'New budget';
    return this.t.mutate(`Create budget ${name}`, () => {
      const id = uuid();
      this.repos.insertVersion({
        id,
        label: name,
        status: 'draft',
        detailLevel: 'full',
        effectiveFrom: null,
        effectiveTo: null,
        copiedFromVersionId: null,
        lockedAt: null,
        grossMonthly: '0',
        taxYear: new Date().getFullYear(),
        filingStatus: 'single',
        notes: null,
      });
      this.t.repos.audit('create', 'budget_version', id, null, { label: name });
      return id;
    });
  }

  duplicateVersion(sourceId: string, label?: string): string {
    const src = this.repos.getVersion(sourceId);
    if (!src) throw new TreasuryError('Budget version not found', 'not_found');
    if (src.detailLevel !== 'full')
      throw new TreasuryError('Summary-only historical versions cannot be duplicated.', 'summary_version');
    return this.t.mutate(`Duplicate budget ${src.label}`, () => {
      const id = uuid();
      this.repos.insertVersion({
        ...src,
        id,
        label: label?.trim() || `${src.label} (copy)`,
        status: 'draft',
        effectiveFrom: null,
        effectiveTo: null,
        copiedFromVersionId: src.id,
        lockedAt: null,
        sourceWorkbook: null,
        sourceSheet: null,
        sourceRange: null,
        importRunId: null,
      });
      for (const d of this.repos.listDeductions(src.id)) this.repos.insertDeduction(id, { ...d, id: uuid() });
      for (const [c, amt] of Object.entries(this.repos.listWithholdings(src.id)))
        this.repos.setWithholding(id, c as WithholdingComponent, amt!);
      for (const l of this.repos.listLines(src.id)) this.repos.insertLine(id, { ...l, id: uuid() });
      this.t.repos.audit('create', 'budget_version', id, null, { copiedFrom: src.id });
      return id;
    });
  }

  updateVersionInfo(
    id: string,
    patch: {
      label?: string;
      notes?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      taxYear?: number | null;
    },
  ) {
    // Label, notes, dates and tax year never change treasury amounts, so they stay editable on locked versions.
    return this.t.mutate('Edit budget details', () => {
      const v = this.repos.getVersion(id);
      if (!v) throw new TreasuryError('Budget version not found', 'not_found');
      const after = { ...v, ...patch };
      if (patch.effectiveFrom) parse(monthKey, patch.effectiveFrom);
      if (patch.effectiveTo) parse(monthKey, patch.effectiveTo);
      if (after.effectiveFrom && after.effectiveTo && after.effectiveTo < after.effectiveFrom) {
        throw new TreasuryError('The end month is before the start month.', 'validation');
      }
      if (patch.label !== undefined && !patch.label.trim())
        throw new TreasuryError('Label is required', 'validation');
      this.repos.updateVersion(after);
      this.t.repos.audit('update', 'budget_version', id, v, after);
    });
  }

  setGross(id: string, amount: string) {
    const m = parse(money, amount);
    return this.t.mutate('Edit gross pay', () => {
      const v = this.editableVersion(id);
      this.repos.updateVersion({ ...v, grossMonthly: normalize(m) });
      this.t.repos.audit(
        'update',
        'budget_version',
        id,
        { grossMonthly: v.grossMonthly },
        { grossMonthly: m },
      );
    });
  }

  setWithholding(id: string, component: WithholdingComponent, amount: string) {
    const m = parse(money, amount);
    if (!WITHHOLDING_COMPONENTS.includes(component))
      throw new TreasuryError('Unknown withholding component', 'validation');
    return this.t.mutate('Edit withholding', () => {
      this.editableVersion(id);
      this.repos.setWithholding(id, component, m);
      this.t.repos.audit('update', 'payroll_withholding', `${id}:${component}`, null, { amount: m });
    });
  }

  addDeduction(versionId: string, input: z.input<typeof DeductionInput>): string {
    const d = parse(DeductionInput, input);
    return this.t.mutate('Add payroll deduction', () => {
      this.editableVersion(versionId);
      const id = uuid();
      const position = this.repos.listDeductions(versionId).reduce((m, x) => Math.max(m, x.position + 1), 0);
      this.repos.insertDeduction(versionId, {
        id,
        position,
        ...d,
        monthlyAmount: d.monthlyAmount ?? null,
        rate: d.rate ?? null,
        monthlyExclusion: d.monthlyExclusion ?? null,
      });
      this.t.repos.audit('create', 'payroll_deduction', id, null, d);
      return id;
    });
  }

  updateDeduction(id: string, input: z.input<typeof DeductionInput>) {
    const d = parse(DeductionInput, input);
    return this.t.mutate('Edit payroll deduction', () => {
      const cur = this.repos.getDeduction(id);
      if (!cur) throw new TreasuryError('Deduction not found', 'not_found');
      this.editableVersion(cur.versionId);
      const after = {
        ...cur.deduction,
        ...d,
        monthlyAmount: d.monthlyAmount ?? null,
        rate: d.rate ?? null,
        monthlyExclusion: d.monthlyExclusion ?? null,
      };
      this.repos.updateDeduction(after);
      this.t.repos.audit('update', 'payroll_deduction', id, cur.deduction, after);
    });
  }

  deleteDeduction(id: string) {
    return this.t.mutate('Delete payroll deduction', () => {
      const cur = this.repos.getDeduction(id);
      if (!cur) throw new TreasuryError('Deduction not found', 'not_found');
      this.editableVersion(cur.versionId);
      this.repos.deleteDeduction(id);
      this.t.repos.audit('delete', 'payroll_deduction', id, cur.deduction, null);
    });
  }

  addLine(versionId: string, input: z.input<typeof LineInput>): string {
    const l = parse(LineInput, input);
    return this.t.mutate('Add budget line', () => {
      this.editableVersion(versionId);
      if (l.kind === 'residual' && this.repos.listLines(versionId).some((x) => x.kind === 'residual')) {
        throw new TreasuryError('This budget already has a remainder line.', 'validation');
      }
      const id = uuid();
      const line: BudgetLine = {
        id,
        position: this.repos.nextLinePosition(versionId),
        ...l,
        fundingAccountId: l.fundingAccountId!,
        monthlyAmount: l.kind === 'residual' ? null : l.monthlyAmount!,
        grossAmount: l.grossAmount ?? null,
      };
      this.repos.insertLine(versionId, line);
      this.t.repos.audit('create', 'budget_line', id, null, line);
      return id;
    });
  }

  updateLine(id: string, input: z.input<typeof LineInput>) {
    const l = parse(LineInput, input);
    return this.t.mutate('Edit budget line', () => {
      const cur = this.repos.getLine(id);
      if (!cur) throw new TreasuryError('Budget line not found', 'not_found');
      this.editableVersion(cur.versionId);
      if (
        l.kind === 'residual' &&
        this.repos.listLines(cur.versionId).some((x) => x.kind === 'residual' && x.id !== id)
      ) {
        throw new TreasuryError('This budget already has a remainder line.', 'validation');
      }
      const after = {
        ...cur,
        ...l,
        fundingAccountId: l.fundingAccountId!,
        monthlyAmount: l.kind === 'residual' ? null : l.monthlyAmount!,
        grossAmount: l.grossAmount ?? null,
      };
      this.repos.updateLine(after);
      this.t.repos.audit('update', 'budget_line', id, cur, after);
    });
  }

  deleteLine(id: string) {
    return this.t.mutate('Delete budget line', () => {
      const cur = this.repos.getLine(id);
      if (!cur) throw new TreasuryError('Budget line not found', 'not_found');
      this.editableVersion(cur.versionId);
      this.repos.deleteLine(id);
      this.t.repos.audit('delete', 'budget_line', id, cur, null);
    });
  }

  addCategory(name: string, description: string | null = null): string {
    if (!name.trim()) throw new TreasuryError('Category name is required', 'validation');
    return this.t.mutate(`Add category ${name}`, () => {
      if (this.repos.getCategoryByName(name))
        throw new TreasuryError(`Category ${name} already exists`, 'duplicate');
      const id = uuid();
      this.repos.insertCategory({
        id,
        name: name.trim(),
        description,
        sortOrder: this.repos.nextCategorySortOrder(),
        active: true,
      });
      return id;
    });
  }

  updateCategory(id: string, patch: { name?: string; description?: string | null }) {
    return this.t.mutate('Edit category', () => {
      const c = this.repos.listCategories().find((x) => x.id === id);
      if (!c) throw new TreasuryError('Category not found', 'not_found');
      const clash = patch.name ? this.repos.getCategoryByName(patch.name) : undefined;
      if (clash && clash.id !== id)
        throw new TreasuryError(`Category ${patch.name} already exists`, 'duplicate');
      this.repos.updateCategory({ ...c, ...patch });
    });
  }

  /**
   * Make a version the active plan from `effectiveFrom`. The previous active
   * version is archived and its range closed the month before.
   */
  activate(id: string, effectiveFrom: string) {
    parse(monthKey, effectiveFrom);
    return this.t.mutate('Activate budget', () => {
      const v = this.repos.getVersion(id);
      if (!v) throw new TreasuryError('Budget version not found', 'not_found');
      if (v.detailLevel !== 'full')
        throw new TreasuryError('Summary-only historical versions cannot be activated.', 'summary_version');
      const issues = this.compute(id).budget.issues;
      if (issues.length)
        throw new TreasuryError(`Fix the budget before activating it: ${issues.join(' ')}`, 'invalid_budget');
      const prev = this.repos.getActiveVersion();
      if (prev && prev.id !== id) {
        const [y, m] = effectiveFrom.split('-').map(Number);
        const before = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        this.repos.updateVersion({ ...prev, status: 'archived', effectiveTo: prev.effectiveTo ?? before });
      }
      this.repos.updateVersion({ ...v, status: 'active', effectiveFrom, effectiveTo: null });
      this.t.repos.audit('activate', 'budget_version', id, prev ? { previous: prev.id } : null, {
        effectiveFrom,
      });
    });
  }

  deleteVersion(id: string) {
    return this.t.mutate('Delete budget', () => {
      const v = this.repos.getVersion(id);
      if (!v) throw new TreasuryError('Budget version not found', 'not_found');
      if (v.status !== 'draft')
        throw new TreasuryError('Only drafts can be deleted; historical versions are kept.', 'read_only');
      if (this.repos.monthsUsingVersion(id).length)
        throw new TreasuryError('Treasury months use this version.', 'referenced');
      this.repos.deleteVersion(id);
      this.t.repos.audit('delete', 'budget_version', id, v, null);
    });
  }

  /** Called by the treasury when a month is created or refreshed from a version. */
  lockVersion(id: string) {
    const v = this.repos.getVersion(id);
    if (v && !v.lockedAt) this.repos.updateVersion({ ...v, lockedAt: new Date().toISOString() });
  }

  suggestedEffectiveMonth(): string {
    // The earliest open month that can follow a budget; archival imported months never do.
    const open = this.t.months().find((m) => !m.closedAt && m.expectedCashOrigin !== 'import');
    return open?.month ?? this.t.proposedNextMonth();
  }

  // ------------------------------------------------------------ tax rules
  ruleSets(): TaxRuleSet[] {
    return this.repos.listRuleSets();
  }

  saveRuleSet(input: {
    taxYear: number;
    jurisdiction: Jurisdiction;
    ratesFromYear: number;
    provisional: boolean;
    rules: unknown;
    sourceNote?: string | null;
    filingStatus?: string;
  }) {
    if (!Number.isInteger(input.taxYear) || input.taxYear < 2000 || input.taxYear > 2100)
      throw new TreasuryError('Enter a valid tax year', 'validation');
    if (!Number.isInteger(input.ratesFromYear))
      throw new TreasuryError('Enter the year the rates come from', 'validation');
    if (!JURISDICTIONS.includes(input.jurisdiction))
      throw new TreasuryError('Unknown jurisdiction', 'validation');
    let rules: unknown;
    try {
      rules = parseRules(input.jurisdiction, input.rules);
    } catch (err) {
      throw new TreasuryError((err as Error).message, 'validation');
    }
    return this.t.mutate(`Save ${input.taxYear} ${input.jurisdiction} tax rules`, () => {
      const filingStatus = input.filingStatus ?? 'single';
      const existing = this.repos.getRuleSet(input.taxYear, input.jurisdiction, filingStatus);
      const r: TaxRuleSet = {
        id: existing?.id ?? uuid(),
        taxYear: input.taxYear,
        jurisdiction: input.jurisdiction,
        filingStatus,
        ratesFromYear: input.ratesFromYear,
        provisional: input.provisional,
        rules,
        sourceNote: input.sourceNote ?? null,
      };
      this.repos.upsertRuleSet(r);
      this.t.repos.audit(existing ? 'update' : 'create', 'tax_rule_set', r.id, existing ?? null, r);
    });
  }

  /** Start a new tax year from an existing one; figures are marked provisional until updated. */
  copyTaxYear(fromYear: number, toYear: number) {
    const src = this.repos.listRuleSets().filter((r) => r.taxYear === fromYear);
    if (!src.length) throw new TreasuryError(`No tax rules exist for ${fromYear}.`, 'not_found');
    return this.t.mutate(`Copy ${fromYear} tax rules to ${toYear}`, () => {
      for (const r of src) {
        if (this.repos.getRuleSet(toYear, r.jurisdiction, r.filingStatus))
          throw new TreasuryError(`${toYear} ${r.jurisdiction} rules already exist.`, 'duplicate');
        this.repos.upsertRuleSet({
          ...r,
          id: uuid(),
          taxYear: toYear,
          provisional: true,
          sourceNote: `Copied from ${fromYear} (rates from ${r.ratesFromYear}); update when ${toYear} figures are published.`,
        });
      }
      this.t.repos.audit('create', 'tax_rule_set', null, null, { copiedFrom: fromYear, to: toYear });
    });
  }

  deleteRuleSet(id: string) {
    return this.t.mutate('Delete tax rules', () => {
      this.repos.deleteRuleSet(id);
      this.t.repos.audit('delete', 'tax_rule_set', id, null, null);
    });
  }

  // ------------------------------------------------------------ import
  /**
   * Commit an analyzed budget workbook in one transaction. Versions are added
   * (history is never replaced); the workbook's current plan becomes active only
   * when `activate` is set. Existing tax rule sets are kept unless replaced.
   * Treasury months, entries and debts are never touched.
   */
  async commitImport(
    plan: BudgetImportPlan,
    opts: { activate: boolean; replaceTaxRules?: boolean },
  ): Promise<{ runId: string; versionIds: string[]; skippedTaxRules: string[] }> {
    if (plan.fatal)
      throw new TreasuryError('The budget workbook has fatal problems and cannot be imported.', 'fatal');
    const runId = uuid();
    const skippedTaxRules: string[] = [];
    const versionIds = this.t.mutate(`Import budget ${plan.filename}`, () => {
      this.t.repos.insertImportRun({
        id: runId,
        filename: plan.filename,
        contentHash: plan.hash,
        recognizerVersion: plan.recognizerVersion,
        mode: 'budget',
        startedAt: new Date().toISOString(),
        completedAt: null,
        committed: false,
        counts: plan.counts,
        controls: plan.controls,
        report: null,
      });
      const accountId = (code: string) => {
        const existing = this.t.repos.getAccountByCode(code);
        if (existing) return existing.id;
        const id = uuid();
        this.t.repos.insertAccount(
          {
            id,
            code,
            displayName: null,
            description: null,
            color: null,
            sortOrder: this.t.repos.nextAccountSortOrder(),
            active: true,
            needsReview: false,
          },
          runId,
        );
        return id;
      };
      const categoryId = (key: string) => {
        const def = CATEGORIES.find((c) => c.key === key);
        if (!def) throw new TreasuryError(`Unknown budget category ${key}`, 'import_integrity');
        const existing = this.repos.getCategoryByName(def.name);
        if (existing) return existing.id;
        const id = uuid();
        this.repos.insertCategory({
          id,
          name: def.name,
          description: def.description,
          sortOrder: CATEGORIES.indexOf(def),
          active: true,
        });
        return id;
      };
      for (const c of CATEGORIES) categoryId(c.key);
      const labels = new Set(this.repos.listVersions().map((v) => v.label));
      const ids: string[] = [];
      for (const v of plan.versions) {
        const id = uuid();
        const label = labels.has(v.label)
          ? `${v.label} (imported ${new Date().toISOString().slice(0, 10)})`
          : v.label;
        labels.add(label);
        const makeActive = v.status === 'active' && opts.activate;
        if (makeActive) {
          const prev = this.repos.getActiveVersion();
          if (prev && v.effectiveFrom) {
            const [y, m] = v.effectiveFrom.split('-').map(Number);
            const before = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
            this.repos.updateVersion({
              ...prev,
              status: 'archived',
              effectiveTo: prev.effectiveTo ?? before,
            });
          } else if (prev) this.repos.updateVersion({ ...prev, status: 'archived' });
        }
        this.repos.insertVersion({
          id,
          label,
          status: v.status === 'active' ? (makeActive ? 'active' : 'draft') : 'archived',
          detailLevel: v.detailLevel,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
          copiedFromVersionId: null,
          lockedAt: null,
          grossMonthly: v.grossMonthly,
          taxYear: v.taxYear,
          filingStatus: 'single',
          notes: v.notes,
          sourceWorkbook: plan.filename,
          sourceSheet: v.sheet,
          sourceRange: v.range,
          importRunId: runId,
        });
        v.deductions.forEach((d) => this.repos.insertDeduction(id, { ...d, id: uuid() }, d.sourceRange));
        for (const w of v.withholdings) this.repos.setWithholding(id, w.component, w.amount, w.sourceRange);
        for (const l of v.lines) {
          this.repos.insertLine(
            id,
            {
              id: uuid(),
              categoryId: categoryId(l.categoryKey),
              label: l.label,
              position: l.position,
              kind: l.kind,
              monthlyAmount: l.monthlyAmount,
              fundingAccountId: accountId(l.fundingCode),
              grossAmount: l.grossAmount,
              notes: l.notes,
            },
            { sheet: l.sheet, range: l.range },
          );
        }
        for (const r of v.summaryRows) this.repos.insertSummaryRow(id, r);
        ids.push(id);
      }
      for (const r of plan.taxRuleSets) {
        const existing = this.repos.getRuleSet(r.taxYear, r.jurisdiction, r.filingStatus);
        if (existing && !opts.replaceTaxRules) {
          skippedTaxRules.push(`${r.taxYear} ${r.jurisdiction}`);
          continue;
        }
        this.repos.upsertRuleSet({ ...r, id: existing?.id ?? uuid() });
      }
      for (const w of plan.warnings) {
        this.t.repos.insertImportWarning({
          id: uuid(),
          importRunId: runId,
          severity: w.severity,
          code: w.code,
          sheet: w.sheet,
          cell: w.cell,
          message: w.message,
          resolved: false,
        });
      }
      this.t.db.run('UPDATE import_runs SET committed = 1, completed_at = ? WHERE id = ?', [
        new Date().toISOString(),
        runId,
      ]);
      this.t.repos.audit('import', 'import_run', runId, null, {
        filename: plan.filename,
        kind: 'budget',
        versions: ids.length,
        skippedTaxRules,
      });
      return ids;
    });
    await this.t.flush();
    return { runId, versionIds, skippedTaxRules };
  }
}
