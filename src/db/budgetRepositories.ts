import { isMoney, normalize, type Money } from '@/domain/money';
import type { BudgetLine } from '@/domain/budget';
import type { PayrollDeduction, WithholdingComponent } from '@/domain/payroll';
import type { Jurisdiction, TaxRuleSet } from '@/domain/tax/rules';
import type { SqlDriver } from './driver';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const nowIso = () => new Date().toISOString();
const b = (v: unknown) => Number(v) === 1;

function money(v: Money | null | undefined, field: string): Money | null {
  if (v === null || v === undefined) return null;
  if (!isMoney(v)) throw new Error(`Invalid decimal for ${field}: ${JSON.stringify(v)}`);
  return normalize(v);
}

export type VersionStatus = 'draft' | 'active' | 'archived';

export interface BudgetCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface BudgetVersion {
  id: string;
  label: string;
  status: VersionStatus;
  detailLevel: 'full' | 'summary';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  copiedFromVersionId: string | null;
  lockedAt: string | null;
  grossMonthly: Money | null;
  taxYear: number | null;
  filingStatus: string;
  notes: string | null;
  sourceWorkbook?: string | null;
  sourceSheet?: string | null;
  sourceRange?: string | null;
  importRunId?: string | null;
}

export interface StoredBudgetLine extends BudgetLine {
  versionId: string;
  sourceSheet: string | null;
  sourceRange: string | null;
}

export interface SummaryRow {
  position: number;
  description: string;
  monthlyAmount: Money | null;
  sourceRange: string | null;
}

const toVersion = (r: Row): BudgetVersion => ({
  id: String(r.id),
  label: String(r.label),
  status: String(r.status) as VersionStatus,
  detailLevel: String(r.detail_level) as 'full' | 'summary',
  effectiveFrom: s(r.effective_from),
  effectiveTo: s(r.effective_to),
  copiedFromVersionId: s(r.copied_from_version_id),
  lockedAt: s(r.locked_at),
  grossMonthly: s(r.gross_monthly),
  taxYear: r.tax_year === null || r.tax_year === undefined ? null : Number(r.tax_year),
  filingStatus: String(r.filing_status),
  notes: s(r.notes),
  sourceWorkbook: s(r.source_workbook),
  sourceSheet: s(r.source_sheet),
  sourceRange: s(r.source_range),
  importRunId: s(r.import_run_id),
});

export class BudgetRepositories {
  constructor(readonly db: SqlDriver) {}

  // ---------------------------------------------------------------- categories
  listCategories(): BudgetCategory[] {
    return this.db.all<Row>('SELECT * FROM budget_categories ORDER BY sort_order, name').map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: s(r.description),
      sortOrder: Number(r.sort_order),
      active: b(r.active),
    }));
  }
  getCategoryByName(name: string) {
    return this.listCategories().find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  }
  insertCategory(c: BudgetCategory) {
    const t = nowIso();
    this.db.run(
      'INSERT INTO budget_categories(id, name, description, sort_order, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [c.id, c.name.trim(), c.description, c.sortOrder, c.active ? 1 : 0, t, t],
    );
  }
  updateCategory(c: BudgetCategory) {
    this.db.run(
      'UPDATE budget_categories SET name=?, description=?, sort_order=?, active=?, updated_at=? WHERE id=?',
      [c.name.trim(), c.description, c.sortOrder, c.active ? 1 : 0, nowIso(), c.id],
    );
  }
  nextCategorySortOrder() {
    return Number(
      this.db.get<Row>('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM budget_categories')?.n ?? 0,
    );
  }

  // ---------------------------------------------------------------- versions
  listVersions(): BudgetVersion[] {
    return this.db
      .all<Row>(
        "SELECT * FROM budget_versions ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, COALESCE(effective_from, '9999') DESC, created_at DESC",
      )
      .map(toVersion);
  }
  getVersion(id: string) {
    const r = this.db.get<Row>('SELECT * FROM budget_versions WHERE id = ?', [id]);
    return r ? toVersion(r) : undefined;
  }
  getActiveVersion() {
    const r = this.db.get<Row>("SELECT * FROM budget_versions WHERE status = 'active'");
    return r ? toVersion(r) : undefined;
  }
  insertVersion(v: BudgetVersion) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO budget_versions(id, label, status, detail_level, effective_from, effective_to, copied_from_version_id, locked_at,
         gross_monthly, tax_year, filing_status, notes, source_workbook, source_sheet, source_range, import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        v.id,
        v.label,
        v.status,
        v.detailLevel,
        v.effectiveFrom,
        v.effectiveTo,
        v.copiedFromVersionId,
        v.lockedAt,
        money(v.grossMonthly, 'gross pay'),
        v.taxYear,
        v.filingStatus,
        v.notes,
        v.sourceWorkbook ?? null,
        v.sourceSheet ?? null,
        v.sourceRange ?? null,
        v.importRunId ?? null,
        t,
        t,
      ],
    );
  }
  updateVersion(v: BudgetVersion) {
    this.db.run(
      `UPDATE budget_versions SET label=?, status=?, effective_from=?, effective_to=?, locked_at=?, gross_monthly=?, tax_year=?,
         filing_status=?, notes=?, updated_at=? WHERE id=?`,
      [
        v.label,
        v.status,
        v.effectiveFrom,
        v.effectiveTo,
        v.lockedAt,
        money(v.grossMonthly, 'gross pay'),
        v.taxYear,
        v.filingStatus,
        v.notes,
        nowIso(),
        v.id,
      ],
    );
  }
  deleteVersion(id: string) {
    this.db.run('DELETE FROM budget_versions WHERE id = ?', [id]);
  }
  monthsUsingVersion(id: string): { id: string; month: string; closedAt: string | null }[] {
    return this.db
      .all<Row>(
        'SELECT id, month, closed_at FROM monthly_cycles WHERE budget_version_id = ? ORDER BY month',
        [id],
      )
      .map((r) => ({ id: String(r.id), month: String(r.month), closedAt: s(r.closed_at) }));
  }

  // ---------------------------------------------------------------- payroll
  listDeductions(versionId: string): PayrollDeduction[] {
    return this.db
      .all<Row>('SELECT * FROM payroll_deductions WHERE version_id = ? ORDER BY position', [versionId])
      .map((r) => ({
        id: String(r.id),
        label: String(r.label),
        position: Number(r.position),
        timing: String(r.timing) as PayrollDeduction['timing'],
        method: String(r.method) as PayrollDeduction['method'],
        monthlyAmount: s(r.monthly_amount),
        rate: s(r.rate),
        monthlyExclusion: s(r.monthly_exclusion),
        reducesFederalIncome: b(r.reduces_federal_income),
        reducesCaIncome: b(r.reduces_ca_income),
        reducesFicaWages: b(r.reduces_fica_wages),
        notes: s(r.notes),
      }));
  }
  insertDeduction(versionId: string, d: PayrollDeduction, sourceRange: string | null = null) {
    this.db.run(
      `INSERT INTO payroll_deductions(id, version_id, label, position, timing, method, monthly_amount, rate, monthly_exclusion,
         reduces_federal_income, reduces_ca_income, reduces_fica_wages, notes, source_range) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.id,
        versionId,
        d.label,
        d.position,
        d.timing,
        d.method,
        money(d.monthlyAmount, 'deduction'),
        money(d.rate, 'rate'),
        money(d.monthlyExclusion, 'exclusion'),
        d.reducesFederalIncome ? 1 : 0,
        d.reducesCaIncome ? 1 : 0,
        d.reducesFicaWages ? 1 : 0,
        d.notes ?? null,
        sourceRange,
      ],
    );
  }
  updateDeduction(d: PayrollDeduction) {
    this.db.run(
      `UPDATE payroll_deductions SET label=?, position=?, timing=?, method=?, monthly_amount=?, rate=?, monthly_exclusion=?,
         reduces_federal_income=?, reduces_ca_income=?, reduces_fica_wages=?, notes=? WHERE id=?`,
      [
        d.label,
        d.position,
        d.timing,
        d.method,
        money(d.monthlyAmount, 'deduction'),
        money(d.rate, 'rate'),
        money(d.monthlyExclusion, 'exclusion'),
        d.reducesFederalIncome ? 1 : 0,
        d.reducesCaIncome ? 1 : 0,
        d.reducesFicaWages ? 1 : 0,
        d.notes ?? null,
        d.id,
      ],
    );
  }
  getDeduction(id: string) {
    const r = this.db.get<Row>('SELECT version_id FROM payroll_deductions WHERE id = ?', [id]);
    return r
      ? {
          versionId: String(r.version_id),
          deduction: this.listDeductions(String(r.version_id)).find((d) => d.id === id)!,
        }
      : undefined;
  }
  deleteDeduction(id: string) {
    this.db.run('DELETE FROM payroll_deductions WHERE id = ?', [id]);
  }
  listWithholdings(versionId: string): Partial<Record<WithholdingComponent, Money>> {
    return Object.fromEntries(
      this.db
        .all<Row>('SELECT component, monthly_amount FROM payroll_withholdings WHERE version_id = ?', [
          versionId,
        ])
        .map((r) => [String(r.component), String(r.monthly_amount)]),
    );
  }
  setWithholding(
    versionId: string,
    component: WithholdingComponent,
    amount: Money,
    sourceRange: string | null = null,
  ) {
    this.db.run(
      `INSERT INTO payroll_withholdings(version_id, component, monthly_amount, source_range) VALUES (?,?,?,?)
       ON CONFLICT(version_id, component) DO UPDATE SET monthly_amount = excluded.monthly_amount`,
      [versionId, component, money(amount, 'withholding'), sourceRange],
    );
  }

  // ---------------------------------------------------------------- lines
  listLines(versionId: string): StoredBudgetLine[] {
    return this.db
      .all<Row>('SELECT * FROM budget_lines WHERE version_id = ? ORDER BY position', [versionId])
      .map((r) => ({
        id: String(r.id),
        versionId: String(r.version_id),
        categoryId: String(r.category_id),
        label: String(r.label),
        position: Number(r.position),
        kind: String(r.kind) as BudgetLine['kind'],
        monthlyAmount: s(r.monthly_amount),
        fundingAccountId: s(r.funding_account_id),
        grossAmount: s(r.gross_amount),
        notes: s(r.notes),
        sourceSheet: s(r.source_sheet),
        sourceRange: s(r.source_range),
      }));
  }
  getLine(id: string) {
    const r = this.db.get<Row>('SELECT version_id FROM budget_lines WHERE id = ?', [id]);
    return r ? this.listLines(String(r.version_id)).find((l) => l.id === id) : undefined;
  }
  insertLine(versionId: string, l: BudgetLine, src: { sheet?: string | null; range?: string | null } = {}) {
    this.db.run(
      `INSERT INTO budget_lines(id, version_id, category_id, label, position, kind, monthly_amount, funding_account_id, gross_amount, notes, source_sheet, source_range)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        l.id,
        versionId,
        l.categoryId,
        l.label,
        l.position,
        l.kind,
        l.kind === 'residual' ? null : money(l.monthlyAmount, 'line amount'),
        l.fundingAccountId,
        money(l.grossAmount ?? null, 'gross amount'),
        l.notes ?? null,
        src.sheet ?? null,
        src.range ?? null,
      ],
    );
  }
  updateLine(l: BudgetLine) {
    this.db.run(
      'UPDATE budget_lines SET category_id=?, label=?, position=?, kind=?, monthly_amount=?, funding_account_id=?, gross_amount=?, notes=? WHERE id=?',
      [
        l.categoryId,
        l.label,
        l.position,
        l.kind,
        l.kind === 'residual' ? null : money(l.monthlyAmount, 'line amount'),
        l.fundingAccountId,
        money(l.grossAmount ?? null, 'gross amount'),
        l.notes ?? null,
        l.id,
      ],
    );
  }
  deleteLine(id: string) {
    this.db.run('DELETE FROM budget_lines WHERE id = ?', [id]);
  }
  nextLinePosition(versionId: string) {
    return Number(
      this.db.get<Row>('SELECT COALESCE(MAX(position), -1) + 1 n FROM budget_lines WHERE version_id = ?', [
        versionId,
      ])?.n ?? 0,
    );
  }

  listSummaryRows(versionId: string): SummaryRow[] {
    return this.db
      .all<Row>('SELECT * FROM budget_summary_rows WHERE version_id = ? ORDER BY position', [versionId])
      .map((r) => ({
        position: Number(r.position),
        description: String(r.description),
        monthlyAmount: s(r.monthly_amount),
        sourceRange: s(r.source_range),
      }));
  }
  insertSummaryRow(versionId: string, r: SummaryRow) {
    this.db.run(
      'INSERT INTO budget_summary_rows(version_id, position, description, monthly_amount, source_range) VALUES (?,?,?,?,?)',
      [versionId, r.position, r.description, money(r.monthlyAmount, 'summary amount'), r.sourceRange],
    );
  }

  // ---------------------------------------------------------------- tax rules
  listRuleSets(): TaxRuleSet[] {
    return this.db.all<Row>('SELECT * FROM tax_rule_sets ORDER BY tax_year DESC, jurisdiction').map((r) => ({
      id: String(r.id),
      taxYear: Number(r.tax_year),
      jurisdiction: String(r.jurisdiction) as Jurisdiction,
      filingStatus: String(r.filing_status),
      ratesFromYear: Number(r.rates_from_year),
      provisional: b(r.provisional),
      rules: JSON.parse(String(r.rules_json)),
      sourceNote: s(r.source_note),
    }));
  }
  getRuleSet(taxYear: number, jurisdiction: Jurisdiction, filingStatus = 'single') {
    return this.listRuleSets().find(
      (r) => r.taxYear === taxYear && r.jurisdiction === jurisdiction && r.filingStatus === filingStatus,
    );
  }
  upsertRuleSet(r: TaxRuleSet) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO tax_rule_sets(id, tax_year, jurisdiction, filing_status, rates_from_year, provisional, rules_json, source_note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tax_year, jurisdiction, filing_status) DO UPDATE SET rates_from_year=excluded.rates_from_year,
         provisional=excluded.provisional, rules_json=excluded.rules_json, source_note=excluded.source_note, updated_at=excluded.updated_at`,
      [
        r.id,
        r.taxYear,
        r.jurisdiction,
        r.filingStatus,
        r.ratesFromYear,
        r.provisional ? 1 : 0,
        JSON.stringify(r.rules),
        r.sourceNote,
        t,
        t,
      ],
    );
  }
  deleteRuleSet(id: string) {
    this.db.run('DELETE FROM tax_rule_sets WHERE id = ?', [id]);
  }
}
