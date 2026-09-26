import { isMoney, normalize, type Money } from '@/domain/money';
import type {
  Account,
  AccountAlias,
  AllocationLine,
  Debt,
  DebtEvent,
  JournalEntry,
  MonthlyCycle,
  Posting,
  TransferState,
} from '@/domain/types';
import type { Param, SqlDriver } from './driver';

type Row = Record<string, unknown>;

const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const nowIso = () => new Date().toISOString();

function money(v: Money, field: string): Money {
  if (!isMoney(v)) throw new Error(`Invalid decimal for ${field}: ${JSON.stringify(v)}`);
  return normalize(v);
}

export interface AllocationProfile {
  id: string;
  name: string;
  expectedCash: Money;
  effectiveFrom: string | null;
  active: boolean;
  flaggedOutOfBalance: boolean;
  lines: { accountId: string; amount: Money }[];
  sourceSheet?: string | null;
  sourceRange?: string | null;
  sourceWorkbook?: string | null;
  importRunId?: string | null;
}

export interface ImportRunRow {
  id: string;
  filename: string;
  contentHash: string;
  recognizerVersion: string;
  mode: string;
  startedAt: string;
  completedAt: string | null;
  committed: boolean;
  counts: Record<string, number> | null;
  controls: unknown;
  report: unknown;
}

export interface ImportWarningRow {
  id: string;
  importRunId: string;
  severity: 'info' | 'warning' | 'high' | 'fatal';
  code: string;
  sheet: string | null;
  cell: string | null;
  message: string;
  resolved: boolean;
}

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
}

const toAccount = (r: Row): Account => ({
  id: String(r.id),
  code: String(r.code),
  displayName: s(r.display_name),
  description: s(r.description),
  color: s(r.color),
  sortOrder: Number(r.sort_order),
  active: Number(r.active) === 1,
  needsReview: Number(r.needs_review) === 1,
});

const toCycle = (r: Row): MonthlyCycle & { closeOverrideNote: string | null } => ({
  id: String(r.id),
  month: String(r.month),
  expectedCash: String(r.expected_cash),
  notes: s(r.notes),
  closedAt: s(r.closed_at),
  closeOverrideNote: s(r.close_override_note),
  budgetVersionId: s(r.budget_version_id),
  expectedCashOrigin: s(r.expected_cash_origin) as MonthlyCycle['expectedCashOrigin'],
  sourceWorkbook: s(r.source_workbook),
  sourceSheet: s(r.source_sheet),
  sourceRange: s(r.source_range),
  importRunId: s(r.source_import_run_id),
});

const toDebt = (r: Row): Debt => ({
  id: String(r.id),
  loanId: String(r.loan_id),
  openedDate: String(r.opened_date),
  description: s(r.description),
  originDebtorAccountId: String(r.origin_debtor_account_id),
  originCreditorAccountId: String(r.origin_creditor_account_id),
  terms: s(r.terms),
  sourceWorkbook: s(r.source_workbook),
  sourceSheet: s(r.source_sheet),
  sourceRange: s(r.source_range),
  importRunId: s(r.import_run_id),
});

const toEvent = (r: Row): DebtEvent => ({
  id: String(r.id),
  debtId: String(r.debt_id),
  eventDate: String(r.event_date),
  sequence: Number(r.sequence),
  changeAmount: String(r.change_amount),
  description: s(r.description),
  notes: s(r.notes),
  journalEntryId: s(r.journal_entry_id),
  sourceDebtor: s(r.source_debtor),
  sourceCreditor: s(r.source_creditor),
  sourceWorkbook: s(r.source_workbook),
  sourceSheet: s(r.source_sheet),
  sourceRange: s(r.source_range),
  importRunId: s(r.import_run_id),
});

export type StoredEntry = JournalEntry & { monthlyCycleId: string; position: number };

export class Repositories {
  constructor(readonly db: SqlDriver) {}

  // ---------------------------------------------------------------- meta
  getMeta(key: string): string | null {
    return s(this.db.get<Row>('SELECT value FROM meta WHERE key = ?', [key])?.value);
  }
  setMeta(key: string, value: string) {
    this.db.run(
      'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // ------------------------------------------------------------ accounts
  listAccounts(): Account[] {
    return this.db.all<Row>('SELECT * FROM accounts ORDER BY sort_order, code').map(toAccount);
  }
  getAccount(id: string): Account | undefined {
    const r = this.db.get<Row>('SELECT * FROM accounts WHERE id = ?', [id]);
    return r ? toAccount(r) : undefined;
  }
  getAccountByCode(code: string): Account | undefined {
    const r = this.db.get<Row>('SELECT * FROM accounts WHERE code = ? COLLATE NOCASE', [code.trim()]);
    return r ? toAccount(r) : undefined;
  }
  nextAccountSortOrder(): number {
    return Number(this.db.get<Row>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts')?.n ?? 0);
  }
  insertAccount(a: Account, importRunId: string | null = null) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO accounts(id, code, display_name, description, color, sort_order, active, needs_review, source_import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        a.id,
        a.code,
        a.displayName,
        a.description,
        a.color,
        a.sortOrder,
        a.active ? 1 : 0,
        a.needsReview ? 1 : 0,
        importRunId,
        t,
        t,
      ],
    );
  }
  updateAccount(a: Account) {
    this.db.run(
      `UPDATE accounts SET code=?, display_name=?, description=?, color=?, sort_order=?, active=?, needs_review=?, updated_at=? WHERE id=?`,
      [
        a.code,
        a.displayName,
        a.description,
        a.color,
        a.sortOrder,
        a.active ? 1 : 0,
        a.needsReview ? 1 : 0,
        nowIso(),
        a.id,
      ],
    );
  }
  deleteAccount(id: string) {
    this.db.run('DELETE FROM accounts WHERE id = ?', [id]);
  }
  accountReferenceCount(id: string): number {
    const q = (sql: string) => Number(this.db.get<Row>(sql, [id])?.n ?? 0);
    return (
      q('SELECT COUNT(*) n FROM journal_postings WHERE account_id = ?') +
      q('SELECT COUNT(*) n FROM monthly_allocations WHERE account_id = ?') +
      q(
        'SELECT COUNT(*) n FROM debts WHERE origin_debtor_account_id = ?1 OR origin_creditor_account_id = ?1',
      ) +
      q('SELECT COUNT(*) n FROM allocation_profile_lines WHERE account_id = ?') +
      q('SELECT COUNT(*) n FROM budget_lines WHERE funding_account_id = ?')
    );
  }

  listAliases(): AccountAlias[] {
    return this.db.all<Row>('SELECT * FROM account_aliases ORDER BY alias').map((r) => ({
      alias: String(r.alias),
      accountId: String(r.account_id),
      originalText: String(r.original_text),
    }));
  }
  insertAlias(al: AccountAlias, note: string | null = null) {
    this.db.run(
      'INSERT INTO account_aliases(alias, account_id, original_text, note, created_at) VALUES (?,?,?,?,?)',
      [al.alias.trim().toUpperCase(), al.accountId, al.originalText, note, nowIso()],
    );
  }
  deleteAlias(alias: string) {
    this.db.run('DELETE FROM account_aliases WHERE alias = ?', [alias.trim().toUpperCase()]);
  }
  deleteAliasesForAccount(accountId: string) {
    this.db.run('DELETE FROM account_aliases WHERE account_id = ?', [accountId]);
  }

  // --------------------------------------------------- allocation profiles
  listProfiles(): AllocationProfile[] {
    const rows = this.db.all<Row>('SELECT * FROM allocation_profiles ORDER BY active DESC, created_at');
    return rows.map((r) => this.profileFromRow(r));
  }
  getActiveProfile(): AllocationProfile | undefined {
    const r = this.db.get<Row>('SELECT * FROM allocation_profiles WHERE active = 1');
    return r ? this.profileFromRow(r) : undefined;
  }
  getProfile(id: string): AllocationProfile | undefined {
    const r = this.db.get<Row>('SELECT * FROM allocation_profiles WHERE id = ?', [id]);
    return r ? this.profileFromRow(r) : undefined;
  }
  private profileFromRow(r: Row): AllocationProfile {
    const lines = this.db
      .all<Row>(
        `SELECT l.account_id, l.amount FROM allocation_profile_lines l JOIN accounts a ON a.id = l.account_id
         WHERE l.profile_id = ? ORDER BY a.sort_order, a.code`,
        [String(r.id)],
      )
      .map((l) => ({ accountId: String(l.account_id), amount: String(l.amount) }));
    return {
      id: String(r.id),
      name: String(r.name),
      expectedCash: String(r.expected_cash),
      effectiveFrom: s(r.effective_from),
      active: Number(r.active) === 1,
      flaggedOutOfBalance: Number(r.flagged_out_of_balance) === 1,
      lines,
      sourceSheet: s(r.source_sheet),
      sourceRange: s(r.source_range),
      sourceWorkbook: s(r.source_workbook),
      importRunId: s(r.source_import_run_id),
    };
  }
  upsertProfile(p: AllocationProfile) {
    const t = nowIso();
    if (p.active)
      this.db.run('UPDATE allocation_profiles SET active = 0 WHERE active = 1 AND id <> ?', [p.id]);
    this.db.run(
      `INSERT INTO allocation_profiles(id, name, expected_cash, effective_from, active, flagged_out_of_balance,
         source_workbook, source_sheet, source_range, source_import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, expected_cash=excluded.expected_cash,
         effective_from=excluded.effective_from, active=excluded.active,
         flagged_out_of_balance=excluded.flagged_out_of_balance, updated_at=excluded.updated_at`,
      [
        p.id,
        p.name,
        money(p.expectedCash, 'expected cash'),
        p.effectiveFrom,
        p.active ? 1 : 0,
        p.flaggedOutOfBalance ? 1 : 0,
        p.sourceWorkbook ?? null,
        p.sourceSheet ?? null,
        p.sourceRange ?? null,
        p.importRunId ?? null,
        t,
        t,
      ],
    );
    this.db.run('DELETE FROM allocation_profile_lines WHERE profile_id = ?', [p.id]);
    for (const l of p.lines) {
      this.db.run('INSERT INTO allocation_profile_lines(profile_id, account_id, amount) VALUES (?,?,?)', [
        p.id,
        l.accountId,
        money(l.amount, 'profile amount'),
      ]);
    }
  }

  // --------------------------------------------------------------- months
  listMonths(): (MonthlyCycle & { closeOverrideNote: string | null })[] {
    return this.db.all<Row>('SELECT * FROM monthly_cycles ORDER BY month').map(toCycle);
  }
  getMonth(id: string) {
    const r = this.db.get<Row>('SELECT * FROM monthly_cycles WHERE id = ?', [id]);
    return r ? toCycle(r) : undefined;
  }
  getMonthByKey(month: string) {
    const r = this.db.get<Row>('SELECT * FROM monthly_cycles WHERE month = ?', [month]);
    return r ? toCycle(r) : undefined;
  }
  insertMonth(m: MonthlyCycle) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO monthly_cycles(id, month, expected_cash, notes, closed_at, budget_version_id, expected_cash_origin,
         source_workbook, source_sheet, source_range, source_import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        m.id,
        m.month,
        money(m.expectedCash, 'expected cash'),
        m.notes,
        m.closedAt,
        m.budgetVersionId ?? null,
        m.expectedCashOrigin ?? null,
        m.sourceWorkbook ?? null,
        m.sourceSheet ?? null,
        m.sourceRange ?? null,
        m.importRunId ?? null,
        t,
        t,
      ],
    );
  }
  updateMonth(m: MonthlyCycle & { closeOverrideNote?: string | null }) {
    this.db.run(
      'UPDATE monthly_cycles SET expected_cash=?, notes=?, closed_at=?, close_override_note=?, budget_version_id=?, expected_cash_origin=?, updated_at=? WHERE id=?',
      [
        money(m.expectedCash, 'expected cash'),
        m.notes,
        m.closedAt,
        m.closeOverrideNote ?? null,
        m.budgetVersionId ?? null,
        m.expectedCashOrigin ?? null,
        nowIso(),
        m.id,
      ],
    );
  }
  deleteMonth(id: string) {
    this.db.run('DELETE FROM monthly_cycles WHERE id = ?', [id]);
  }

  listAllocations(monthId: string): (AllocationLine & { sourceRange: string | null })[] {
    return this.db
      .all<Row>(
        `SELECT m.* FROM monthly_allocations m JOIN accounts a ON a.id = m.account_id
         WHERE m.monthly_cycle_id = ? ORDER BY a.sort_order, a.code`,
        [monthId],
      )
      .map((r) => ({
        accountId: String(r.account_id),
        budgetAmount: String(r.budget_amount),
        transferState: String(r.transfer_state) as TransferState,
        notes: s(r.notes),
        plannedAmount: s(r.planned_amount),
        origin: s(r.allocation_origin) as AllocationLine['origin'],
        sourceRange: s(r.source_range),
      }));
  }
  upsertAllocation(monthId: string, a: AllocationLine, sourceRange: string | null = null) {
    this.db.run(
      `INSERT INTO monthly_allocations(monthly_cycle_id, account_id, budget_amount, transfer_state, notes, source_range, planned_amount, allocation_origin)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(monthly_cycle_id, account_id) DO UPDATE SET budget_amount=excluded.budget_amount,
         transfer_state=excluded.transfer_state, notes=excluded.notes,
         planned_amount=excluded.planned_amount, allocation_origin=excluded.allocation_origin`,
      [
        monthId,
        a.accountId,
        money(a.budgetAmount, 'budget allocation'),
        a.transferState,
        a.notes,
        sourceRange,
        a.plannedAmount == null ? null : money(a.plannedAmount, 'planned amount'),
        a.origin ?? null,
      ],
    );
  }
  deleteAllocation(monthId: string, accountId: string) {
    this.db.run('DELETE FROM monthly_allocations WHERE monthly_cycle_id = ? AND account_id = ?', [
      monthId,
      accountId,
    ]);
  }

  private entriesWhere(where: string, params: Param[]): StoredEntry[] {
    const rows = this.db.all<Row>(
      `SELECT * FROM journal_entries WHERE ${where} ORDER BY position, created_at`,
      params,
    );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const postings = new Map<string, Posting[]>();
    // Chunk to stay within SQLite's host-parameter limit.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const prow = this.db.all<Row>(
        `SELECT * FROM journal_postings WHERE journal_entry_id IN (${chunk.map(() => '?').join(',')}) ORDER BY position`,
        chunk,
      );
      for (const p of prow) {
        const list = postings.get(String(p.journal_entry_id)) ?? [];
        list.push({
          id: String(p.id),
          accountId: String(p.account_id),
          amount: String(p.amount),
          position: Number(p.position),
          originalCode: s(p.original_code),
        });
        postings.set(String(p.journal_entry_id), list);
      }
    }
    return rows.map((r) => ({
      id: String(r.id),
      monthlyCycleId: String(r.monthly_cycle_id),
      position: Number(r.position),
      entryDate: s(r.entry_date),
      loanId: s(r.loan_id),
      description: s(r.description),
      notes: s(r.notes),
      sourceKind: String(r.source_kind) as JournalEntry['sourceKind'],
      draftReason: s(r.draft_reason),
      sourceWorkbook: s(r.source_workbook),
      sourceSheet: s(r.source_sheet),
      sourceRange: s(r.source_range),
      importRunId: s(r.import_run_id),
      postings: postings.get(String(r.id)) ?? [],
    }));
  }
  listEntries(monthId: string): StoredEntry[] {
    return this.entriesWhere('monthly_cycle_id = ?', [monthId]);
  }
  listAllEntries(): StoredEntry[] {
    return this.entriesWhere('1 = 1', []);
  }
  getEntry(id: string): StoredEntry | undefined {
    return this.entriesWhere('id = ?', [id])[0];
  }
  entriesForLoan(loanId: string): StoredEntry[] {
    return this.entriesWhere('loan_id = ?', [loanId]);
  }
  nextEntryPosition(monthId: string): number {
    return Number(
      this.db.get<Row>(
        'SELECT COALESCE(MAX(position), -1) + 1 n FROM journal_entries WHERE monthly_cycle_id = ?',
        [monthId],
      )?.n ?? 0,
    );
  }
  insertEntry(monthId: string, e: JournalEntry, position: number) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO journal_entries(id, monthly_cycle_id, position, entry_date, loan_id, description, notes, source_kind, draft_reason,
         source_workbook, source_sheet, source_range, import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        e.id,
        monthId,
        position,
        e.entryDate,
        e.loanId,
        e.description,
        e.notes,
        e.sourceKind,
        e.draftReason,
        e.sourceWorkbook ?? null,
        e.sourceSheet ?? null,
        e.sourceRange ?? null,
        e.importRunId ?? null,
        t,
        t,
      ],
    );
    this.insertPostings(e.id, e.postings);
  }
  private insertPostings(entryId: string, postings: Posting[]) {
    for (const p of postings) {
      this.db.run(
        'INSERT INTO journal_postings(id, journal_entry_id, account_id, amount, position, original_code) VALUES (?,?,?,?,?,?)',
        [p.id, entryId, p.accountId, money(p.amount, 'posting amount'), p.position, p.originalCode ?? null],
      );
    }
  }
  updateEntry(e: JournalEntry) {
    this.db.run(
      'UPDATE journal_entries SET entry_date=?, loan_id=?, description=?, notes=?, draft_reason=?, updated_at=? WHERE id=?',
      [e.entryDate, e.loanId, e.description, e.notes, e.draftReason, nowIso(), e.id],
    );
    this.db.run('DELETE FROM journal_postings WHERE journal_entry_id = ?', [e.id]);
    this.insertPostings(e.id, e.postings);
  }
  deleteEntry(id: string) {
    this.db.run('DELETE FROM journal_entries WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------------- debts
  listDebts(): Debt[] {
    return this.db.all<Row>('SELECT * FROM debts ORDER BY created_at, rowid').map(toDebt);
  }
  getDebt(id: string): Debt | undefined {
    const r = this.db.get<Row>('SELECT * FROM debts WHERE id = ?', [id]);
    return r ? toDebt(r) : undefined;
  }
  getDebtByLoanId(loanId: string): Debt | undefined {
    const r = this.db.get<Row>('SELECT * FROM debts WHERE loan_id = ?', [loanId.trim()]);
    return r ? toDebt(r) : undefined;
  }
  insertDebt(d: Debt) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO debts(id, loan_id, opened_date, description, origin_debtor_account_id, origin_creditor_account_id, terms,
         source_workbook, source_sheet, source_range, import_run_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.id,
        d.loanId,
        d.openedDate,
        d.description,
        d.originDebtorAccountId,
        d.originCreditorAccountId,
        d.terms,
        d.sourceWorkbook ?? null,
        d.sourceSheet ?? null,
        d.sourceRange ?? null,
        d.importRunId ?? null,
        t,
        t,
      ],
    );
  }
  updateDebt(d: Debt) {
    this.db.run(
      `UPDATE debts SET opened_date=?, description=?, origin_debtor_account_id=?, origin_creditor_account_id=?, terms=?, updated_at=? WHERE id=?`,
      [
        d.openedDate,
        d.description,
        d.originDebtorAccountId,
        d.originCreditorAccountId,
        d.terms,
        nowIso(),
        d.id,
      ],
    );
  }
  deleteDebt(id: string) {
    this.db.run('DELETE FROM debts WHERE id = ?', [id]);
  }
  listEvents(debtId: string): DebtEvent[] {
    return this.db
      .all<Row>('SELECT * FROM debt_events WHERE debt_id = ? ORDER BY event_date, sequence', [debtId])
      .map(toEvent);
  }
  listAllEvents(): DebtEvent[] {
    return this.db.all<Row>('SELECT * FROM debt_events ORDER BY sequence').map(toEvent);
  }
  getEvent(id: string): DebtEvent | undefined {
    const r = this.db.get<Row>('SELECT * FROM debt_events WHERE id = ?', [id]);
    return r ? toEvent(r) : undefined;
  }
  eventsForJournalEntry(entryId: string): DebtEvent[] {
    return this.db.all<Row>('SELECT * FROM debt_events WHERE journal_entry_id = ?', [entryId]).map(toEvent);
  }
  /** Sequence is global so that exporting by sequence reproduces source ledger row order. */
  nextEventSequence(): number {
    return Number(this.db.get<Row>('SELECT COALESCE(MAX(sequence), 0) + 1 n FROM debt_events')?.n ?? 1);
  }
  insertEvent(e: DebtEvent) {
    const t = nowIso();
    this.db.run(
      `INSERT INTO debt_events(id, debt_id, event_date, sequence, change_amount, description, notes, journal_entry_id,
         source_debtor, source_creditor, source_workbook, source_sheet, source_range, import_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        e.id,
        e.debtId,
        e.eventDate,
        e.sequence,
        money(e.changeAmount, 'debt change'),
        e.description,
        e.notes,
        e.journalEntryId,
        e.sourceDebtor ?? null,
        e.sourceCreditor ?? null,
        e.sourceWorkbook ?? null,
        e.sourceSheet ?? null,
        e.sourceRange ?? null,
        e.importRunId ?? null,
        t,
        t,
      ],
    );
  }
  updateEvent(e: DebtEvent) {
    this.db.run(
      'UPDATE debt_events SET event_date=?, change_amount=?, description=?, notes=?, journal_entry_id=?, updated_at=? WHERE id=?',
      [
        e.eventDate,
        money(e.changeAmount, 'debt change'),
        e.description,
        e.notes,
        e.journalEntryId,
        nowIso(),
        e.id,
      ],
    );
  }
  deleteEvent(id: string) {
    this.db.run('DELETE FROM debt_events WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------- import runs
  insertImportRun(r: ImportRunRow) {
    this.db.run(
      `INSERT INTO import_runs(id, filename, content_hash, recognizer_version, mode, started_at, completed_at, committed, counts_json, controls_json, report_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.id,
        r.filename,
        r.contentHash,
        r.recognizerVersion,
        r.mode,
        r.startedAt,
        r.completedAt,
        r.committed ? 1 : 0,
        JSON.stringify(r.counts),
        JSON.stringify(r.controls),
        JSON.stringify(r.report),
      ],
    );
  }
  listImportRuns(): ImportRunRow[] {
    return this.db.all<Row>('SELECT * FROM import_runs ORDER BY started_at DESC').map((r) => ({
      id: String(r.id),
      filename: String(r.filename),
      contentHash: String(r.content_hash),
      recognizerVersion: String(r.recognizer_version),
      mode: String(r.mode),
      startedAt: String(r.started_at),
      completedAt: s(r.completed_at),
      committed: Number(r.committed) === 1,
      counts: r.counts_json ? JSON.parse(String(r.counts_json)) : null,
      controls: r.controls_json ? JSON.parse(String(r.controls_json)) : null,
      report: r.report_json ? JSON.parse(String(r.report_json)) : null,
    }));
  }
  committedRunsWithHash(hash: string): ImportRunRow[] {
    return this.listImportRuns().filter((r) => r.committed && r.contentHash === hash);
  }
  insertImportWarning(w: ImportWarningRow) {
    this.db.run(
      'INSERT INTO import_warnings(id, import_run_id, severity, code, sheet, cell, message, resolved) VALUES (?,?,?,?,?,?,?,?)',
      [w.id, w.importRunId, w.severity, w.code, w.sheet, w.cell, w.message, w.resolved ? 1 : 0],
    );
  }
  listImportWarnings(runId?: string): ImportWarningRow[] {
    const rows = runId
      ? this.db.all<Row>('SELECT * FROM import_warnings WHERE import_run_id = ? ORDER BY rowid', [runId])
      : this.db.all<Row>('SELECT * FROM import_warnings ORDER BY rowid');
    return rows.map((r) => ({
      id: String(r.id),
      importRunId: String(r.import_run_id),
      severity: String(r.severity) as ImportWarningRow['severity'],
      code: String(r.code),
      sheet: s(r.sheet),
      cell: s(r.cell),
      message: String(r.message),
      resolved: Number(r.resolved) === 1,
    }));
  }
  setWarningResolved(id: string, resolved: boolean) {
    this.db.run('UPDATE import_warnings SET resolved = ? WHERE id = ?', [resolved ? 1 : 0, id]);
  }

  // ---------------------------------------------------------------- audit
  audit(
    action: string,
    entity: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    note: string | null = null,
  ) {
    this.db.run(
      'INSERT INTO audit_log(at, action, entity, entity_id, before_json, after_json, note) VALUES (?,?,?,?,?,?,?)',
      [
        nowIso(),
        action,
        entity,
        entityId,
        before === undefined ? null : JSON.stringify(before),
        after === undefined ? null : JSON.stringify(after),
        note,
      ],
    );
  }
  listAudit(limit = 200, entity?: string, entityId?: string): AuditRow[] {
    const where: string[] = [];
    const params: Param[] = [];
    if (entity) {
      where.push('entity = ?');
      params.push(entity);
    }
    if (entityId) {
      where.push('entity_id = ?');
      params.push(entityId);
    }
    params.push(limit);
    return this.db
      .all<Row>(
        `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`,
        params,
      )
      .map((r) => ({
        id: Number(r.id),
        at: String(r.at),
        action: String(r.action),
        entity: String(r.entity),
        entityId: s(r.entity_id),
        before: r.before_json ? JSON.parse(String(r.before_json)) : null,
        after: r.after_json ? JSON.parse(String(r.after_json)) : null,
        note: s(r.note),
      }));
  }
}
