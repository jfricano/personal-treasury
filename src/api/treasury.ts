import type { SqlJsStatic } from 'sql.js';
import { AccountResolver, codeKey } from '@/domain/accounts';
import {
  type DebtPosition,
  type DebtSummary,
  debtPosition,
  paymentToChange,
  previewChange,
  summarizeDebts,
  suggestChangeForTransfer,
} from '@/domain/debts';
import {
  type EntryResult,
  type MonthResult,
  asSimpleTransfer,
  computeMonth,
  nextMonth,
} from '@/domain/monthly';
import { type Money, ZERO, isEffectivelyZero, normalize, sub, sum } from '@/domain/money';
import type {
  Account,
  AllocationLine,
  Debt,
  DebtEvent,
  JournalEntry,
  MonthlyCycle,
  TransferState,
} from '@/domain/types';
import { SqlJsDriver, loadSqlJs, type SqlDriver } from '@/db/driver';
import { migrate } from '@/db/migrations';
import { type AllocationProfile, Repositories, type StoredEntry } from '@/db/repositories';
import { type DatabaseStorage, MemoryStorage } from '@/db/storage';
import type { ImportPlan } from '@/import/plan';
import { computePlannedMonth } from '@/import/analyze';
import {
  AccountInput,
  AdjustmentInput,
  AdvancedEntryInput,
  EventEditInput,
  NewDebtInput,
  NewMonthInput,
  PaymentInput,
  ProfileInput,
  TransferInputSchema,
  firstError,
} from './schemas';
import type { z } from 'zod';

import { TreasuryError } from './errors';
import { BudgetService } from './budget';
import { diffMonthAgainstBudget, type BudgetDiff } from '@/domain/budget';
export { TreasuryError };

const uuid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new TreasuryError(firstError(r.error), 'validation');
  return r.data;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface DebtLink {
  debtId: string;
  loanId: string;
  eventId: string;
  changeAmount: Money;
}

export interface EntryView {
  entry: StoredEntry;
  result: EntryResult;
  simple: { fromAccountId: string; toAccountId: string; amount: Money } | null;
  debtLinks: DebtLink[];
  /** Proposed debt change when the entry names a Loan ID and moves cash between its parties. */
  debtSuggestion: { debtId: string; loanId: string; change: Money } | null;
}

export interface MonthView {
  cycle: MonthlyCycle & { closeOverrideNote: string | null };
  result: MonthResult;
  entries: EntryView[];
  closed: boolean;
  imported: boolean;
}

export interface MonthSummaryRow {
  id: string;
  month: string;
  expectedCash: Money;
  status: MonthResult['status'];
  allocationDifference: Money;
  journalDifference: Money;
  finalTotal: Money;
  closedAt: string | null;
  imported: boolean;
  issueCount: number;
}

export interface DebtBoard {
  positions: DebtPosition[];
  summary: DebtSummary;
}

export interface OpenOptions {
  storage?: DatabaseStorage;
  profile?: string;
  SQL?: SqlJsStatic;
  locateWasm?: (file: string) => string;
}

/**
 * Treasury tables a workbook re-import replaces. Accounts are *not* listed:
 * budget lines reference them, so a replace updates accounts in place by code
 * and never deletes them (design conflict C1). Budget tables are never touched.
 */
const TREASURY_TABLES = [
  'debt_events',
  'debts',
  'journal_postings',
  'journal_entries',
  'monthly_allocations',
  'monthly_cycles',
  'allocation_profile_lines',
  'allocation_profiles',
  'account_aliases',
];

const UNDO_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Application service ("API") over the local SQLite database. Every mutation
 * runs in one transaction, is validated at the boundary, and recomputes all
 * derived values through the domain layer on the next read.
 */
export class Treasury {
  readonly repos: Repositories;
  version = 0;
  saveState: 'saved' | 'saving' | 'error' = 'saved';
  lastSaveError: string | null = null;
  private listeners = new Set<() => void>();
  private undoStack: { label: string; bytes: Uint8Array }[] = [];
  private saveChain: Promise<void> = Promise.resolve();

  private constructor(
    readonly db: SqlDriver,
    readonly storage: DatabaseStorage,
    readonly profile: string,
  ) {
    this.repos = new Repositories(db);
    this.budget = new BudgetService(this);
  }

  /** Budget plans, payroll and tax rules (see api/budget.ts). */
  readonly budget: BudgetService;

  static async open(opts: OpenOptions = {}): Promise<Treasury> {
    const SQL = opts.SQL ?? (await loadSqlJs(opts.locateWasm));
    const storage = opts.storage ?? new MemoryStorage();
    const profile = opts.profile ?? 'default';
    const bytes = await storage.load(profile);
    const db = new SqlJsDriver(SQL, bytes);
    const { from, to } = migrate(db);
    const t = new Treasury(db, storage, profile);
    if (!bytes || from !== to) await t.persistNow();
    return t;
  }

  // ------------------------------------------------------------ plumbing
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Run `fn` in one transaction with undo snapshot, persistence and change notification. */
  mutate<T>(label: string, fn: () => T, opts: { undoable?: boolean } = {}): T {
    const snapshot = opts.undoable === false ? null : this.db.export();
    const result = this.db.transaction(fn);
    if (snapshot) this.pushUndo(label, snapshot);
    this.schedulePersist();
    this.notify();
    return result;
  }

  private pushUndo(label: string, bytes: Uint8Array) {
    this.undoStack.push({ label, bytes });
    let total = this.undoStack.reduce((n, s) => n + s.bytes.byteLength, 0);
    while (this.undoStack.length > 1 && total > UNDO_LIMIT_BYTES)
      total -= this.undoStack.shift()!.bytes.byteLength;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  /** Restore the database to the state before the last reversible edit. */
  undo(): string | null {
    const top = this.undoStack.pop();
    if (!top) return null;
    this.db.replace(top.bytes);
    this.repos.audit('undo', 'session', null, null, null, `Undid: ${top.label}`);
    this.schedulePersist();
    this.notify();
    return top.label;
  }

  private schedulePersist() {
    this.saveState = 'saving';
    this.saveChain = this.saveChain.then(() => this.persistNow()).catch(() => undefined);
  }

  private async persistNow() {
    try {
      await this.storage.save(this.profile, this.db.export());
      const changed = this.saveState !== 'saved';
      this.saveState = 'saved';
      this.lastSaveError = null;
      if (changed) this.notify();
    } catch (err) {
      this.saveState = 'error';
      this.lastSaveError = (err as Error).message;
      this.notify();
      throw err;
    }
  }

  /** Wait for pending writes to reach storage. */
  async flush() {
    await this.saveChain;
    if (this.saveState === 'error')
      throw new TreasuryError(`Could not save the database: ${this.lastSaveError}`, 'save_failed');
  }

  // ------------------------------------------------------------ accounts
  accounts(): Account[] {
    return this.repos.listAccounts();
  }

  accountMap(): Map<string, Account> {
    return new Map(this.accounts().map((a) => [a.id, a]));
  }

  codeOf = (id: string): string => this.repos.getAccount(id)?.code ?? `?${id.slice(0, 6)}`;
  nameOf = (id: string): string => {
    const account = this.repos.getAccount(id);
    return account ? account.displayName || account.code : `?${id.slice(0, 6)}`;
  };

  resolver(): AccountResolver {
    return new AccountResolver(this.accounts(), this.repos.listAliases());
  }

  aliases() {
    return this.repos.listAliases();
  }

  isEmpty(): boolean {
    return (
      this.accounts().length === 0 &&
      this.repos.listMonths().length === 0 &&
      this.repos.listDebts().length === 0 &&
      this.budget.repos.listVersions().length === 0
    );
  }

  createAccount(input: z.input<typeof AccountInput>): Account {
    const v = parse(AccountInput, input);
    return this.mutate(`Create account ${v.code}`, () => {
      if (this.repos.getAccountByCode(v.code))
        throw new TreasuryError(`Account ${v.code} already exists`, 'duplicate');
      if (this.repos.listAliases().some((a) => codeKey(a.alias) === codeKey(v.code))) {
        throw new TreasuryError(`${v.code} is already an alias of another account`, 'duplicate');
      }
      const a: Account = {
        id: uuid(),
        code: v.code,
        displayName: v.displayName,
        description: v.description,
        color: v.color,
        sortOrder: this.repos.nextAccountSortOrder(),
        active: true,
        needsReview: false,
      };
      this.repos.insertAccount(a);
      this.repos.audit('create', 'account', a.id, null, a);
      return a;
    });
  }

  /** Names are the user-facing identity. A generated key keeps older workbook links stable. */
  createNamedAccount(name: string): Account {
    const displayName = name.trim();
    if (!displayName) throw new TreasuryError('Account name is required', 'validation');
    if (
      this.accounts().some((a) =>
        [a.displayName, a.code].some((value) => value?.toLowerCase() === displayName.toLowerCase()),
      )
    )
      throw new TreasuryError(`Account ${displayName} already exists`, 'duplicate');
    return this.createAccount({ code: `A${uuid().replace(/-/g, '').slice(0, 20)}`, displayName });
  }

  updateAccount(
    id: string,
    patch: Partial<
      Pick<Account, 'displayName' | 'description' | 'color' | 'active' | 'needsReview' | 'code'>
    >,
  ) {
    return this.mutate('Edit account', () => {
      const before = this.repos.getAccount(id);
      if (!before) throw new TreasuryError('Account not found', 'not_found');
      const after: Account = { ...before, ...patch };
      if (patch.displayName !== undefined) {
        const name = patch.displayName?.trim();
        if (!name) throw new TreasuryError('Account name is required', 'validation');
        if (
          this.accounts().some(
            (a) =>
              a.id !== id &&
              [a.displayName, a.code].some((value) => value?.toLowerCase() === name.toLowerCase()),
          )
        )
          throw new TreasuryError(`Account ${name} already exists`, 'duplicate');
        after.displayName = name;
      }
      if (patch.code !== undefined) {
        after.code = parse(AccountInput.shape.code, patch.code);
        const clash = this.repos.getAccountByCode(after.code);
        if (clash && clash.id !== id)
          throw new TreasuryError(`Account ${after.code} already exists`, 'duplicate');
      }
      this.repos.updateAccount(after);
      this.repos.audit('update', 'account', id, before, after);
      return after;
    });
  }

  moveAccount(id: string, delta: -1 | 1) {
    return this.mutate('Reorder accounts', () => {
      const list = this.accounts();
      const i = list.findIndex((a) => a.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((a, k) => {
        if (a.sortOrder !== k) this.repos.updateAccount({ ...a, sortOrder: k });
      });
    });
  }

  /** Referenced accounts cannot be deleted; archive them instead. */
  deleteAccount(id: string) {
    return this.mutate('Delete account', () => {
      const a = this.repos.getAccount(id);
      if (!a) throw new TreasuryError('Account not found', 'not_found');
      const refs = this.repos.accountReferenceCount(id);
      if (refs > 0)
        throw new TreasuryError(
          `${a.displayName || a.code} is used by ${refs} record(s). Archive it instead.`,
          'referenced',
        );
      this.repos.deleteAliasesForAccount(id);
      this.repos.deleteAccount(id);
      this.repos.audit('delete', 'account', id, a, null);
    });
  }

  addAlias(aliasText: string, accountId: string) {
    const text = aliasText.trim();
    if (!text) throw new TreasuryError('Alias text is required', 'validation');
    return this.mutate(`Add alias ${text}`, () => {
      if (this.repos.getAccountByCode(text))
        throw new TreasuryError(`${text} is already an account code`, 'duplicate');
      if (this.repos.listAliases().some((a) => codeKey(a.alias) === codeKey(text)))
        throw new TreasuryError(`Alias ${text} already exists`, 'duplicate');
      this.repos.insertAlias({ alias: text, accountId, originalText: text }, 'Added by user');
      this.repos.audit('create', 'alias', text, null, { alias: text, accountId });
    });
  }

  removeAlias(alias: string) {
    return this.mutate(`Remove alias ${alias}`, () => {
      this.repos.deleteAlias(alias);
      this.repos.audit('delete', 'alias', alias, { alias }, null);
    });
  }

  // ----------------------------------------------------- allocation profile
  activeProfile(): AllocationProfile | undefined {
    return this.repos.getActiveProfile();
  }

  saveProfile(input: z.input<typeof ProfileInput>) {
    const v = parse(ProfileInput, input);
    const total = sum(v.lines.map((l) => l.amount));
    const outOfBalance = !isEffectivelyZero(sub(total, v.expectedCash));
    if (outOfBalance && !v.confirmOutOfBalance) {
      throw new TreasuryError(
        `Allocations total ${total} but expected cash is ${v.expectedCash}. Confirm to save out of balance.`,
        'out_of_balance',
      );
    }
    return this.mutate('Save allocation profile', () => {
      const existing = this.repos.getActiveProfile();
      const p: AllocationProfile = {
        id: existing?.id ?? uuid(),
        name: existing?.name ?? 'Current allocations',
        expectedCash: normalize(v.expectedCash),
        effectiveFrom: existing?.effectiveFrom ?? null,
        active: true,
        flaggedOutOfBalance: outOfBalance,
        lines: v.lines.map((l) => ({ accountId: l.accountId, amount: normalize(l.amount) })),
      };
      this.repos.upsertProfile(p);
      this.repos.audit(
        'update',
        'allocation_profile',
        p.id,
        existing ?? null,
        p,
        outOfBalance ? 'Saved out of balance by user confirmation' : null,
      );
      return p;
    });
  }

  // --------------------------------------------------------------- months
  months() {
    return this.repos.listMonths();
  }

  /** Latest month that is still open, otherwise the latest month. */
  currentMonthId(): string | null {
    const list = this.repos.listMonths();
    const open = list.filter((m) => !m.closedAt);
    return (open[open.length - 1] ?? list[list.length - 1])?.id ?? null;
  }

  proposedNextMonth(): string {
    const list = this.repos.listMonths();
    if (list.length) return nextMonth(list[list.length - 1].month);
    return today().slice(0, 7);
  }

  private computeFor(cycle: MonthlyCycle, entries?: StoredEntry[]): MonthResult {
    const accounts = this.accounts();
    const codes = new Map(accounts.map((a) => [a.id, a.displayName || a.code]));
    return computeMonth({
      expectedCash: cycle.expectedCash,
      allocations: this.repos.listAllocations(cycle.id),
      entries: entries ?? this.repos.listEntries(cycle.id),
      accountOrder: accounts.map((a) => a.id),
      accountCode: (id) => codes.get(id) ?? id,
    });
  }

  monthSummaries(): MonthSummaryRow[] {
    return this.repos.listMonths().map((m) => {
      const r = this.computeFor(m);
      return {
        id: m.id,
        month: m.month,
        expectedCash: m.expectedCash,
        status: r.status,
        allocationDifference: r.allocationDifference,
        journalDifference: r.journalDifference,
        finalTotal: r.totals.finalTransfer,
        closedAt: m.closedAt,
        imported: !!m.importRunId,
        issueCount: r.issues.filter((i) => i.blocking).length,
      };
    });
  }

  monthView(monthId: string): MonthView {
    const cycle = this.repos.getMonth(monthId);
    if (!cycle) throw new TreasuryError('Month not found', 'not_found');
    const entries = this.repos.listEntries(monthId);
    const result = this.computeFor(cycle, entries);
    const byId = new Map(result.entryResults.map((r) => [r.entryId, r]));
    const debts = new Map(this.repos.listDebts().map((d) => [d.loanId, d]));
    const debtById = new Map([...debts.values()].map((d) => [d.id, d]));
    const views: EntryView[] = entries.map((entry) => {
      const links: DebtLink[] = this.repos.eventsForJournalEntry(entry.id).map((ev) => ({
        debtId: ev.debtId,
        loanId: debtById.get(ev.debtId)?.loanId ?? '?',
        eventId: ev.id,
        changeAmount: ev.changeAmount,
      }));
      const simple = asSimpleTransfer(entry);
      let debtSuggestion: EntryView['debtSuggestion'] = null;
      const debt = entry.loanId ? debts.get(entry.loanId.trim()) : undefined;
      if (debt && simple && links.length === 0) {
        const change = suggestChangeForTransfer(debt, simple);
        if (change) debtSuggestion = { debtId: debt.id, loanId: debt.loanId, change };
      }
      return { entry, result: byId.get(entry.id)!, simple, debtLinks: links, debtSuggestion };
    });
    return { cycle, result, entries: views, closed: !!cycle.closedAt, imported: !!cycle.importRunId };
  }

  private assertOpen(monthId: string) {
    const m = this.repos.getMonth(monthId);
    if (!m) throw new TreasuryError('Month not found', 'not_found');
    if (m.closedAt) throw new TreasuryError(`${m.month} is closed. Reopen it before editing.`, 'closed');
    return m;
  }

  createMonth(input: z.input<typeof NewMonthInput>): string {
    const v = parse(NewMonthInput, input);
    return this.mutate(`Create month ${v.month}`, () => {
      if (this.repos.getMonthByKey(v.month))
        throw new TreasuryError(`${v.month} already exists`, 'duplicate');
      let expectedCash: Money = ZERO;
      let lines: AllocationLine[];
      let budgetVersionId: string | null = null;
      let cashOrigin: 'budget' | 'template' = 'template';
      if (v.source === 'budget') {
        const version = v.budgetVersionId
          ? this.budget.repos.getVersion(v.budgetVersionId)
          : this.budget.activeVersion();
        if (!version)
          throw new TreasuryError('There is no active budget. Activate a budget version first.', 'no_budget');
        const plan = this.budget.compute(version.id);
        if (plan.budget.issues.length) {
          throw new TreasuryError(
            `Budget ${version.label} needs attention: ${plan.budget.issues.join(' ')}`,
            'invalid_budget',
          );
        }
        // Planned funding amounts only: no journal entries or postings are created.
        expectedCash = plan.payroll.takeHome;
        lines = plan.budget.byFundingAccount.map((f) => ({
          accountId: f.accountId,
          budgetAmount: f.amount,
          plannedAmount: f.amount,
          origin: 'budget',
          transferState: 'pending',
          notes: null,
        }));
        budgetVersionId = version.id;
        cashOrigin = 'budget';
        this.budget.lockVersion(version.id);
      } else if (v.source === 'template') {
        const p = this.repos.getActiveProfile();
        if (!p)
          throw new TreasuryError(
            'There is no allocation template yet. Create the month blank or import a workbook.',
            'no_template',
          );
        expectedCash = p.expectedCash;
        lines = p.lines.map((l) => ({
          accountId: l.accountId,
          budgetAmount: l.amount,
          transferState: 'pending',
          notes: null,
        }));
      } else if (v.source === 'duplicate') {
        const src = v.duplicateFromMonthId ? this.repos.getMonth(v.duplicateFromMonthId) : undefined;
        if (!src) throw new TreasuryError('Choose a month to duplicate', 'validation');
        expectedCash = src.expectedCash;
        lines = this.repos.listAllocations(src.id).map((a) => ({
          accountId: a.accountId,
          budgetAmount: a.budgetAmount,
          transferState: 'pending',
          notes: null,
        }));
      } else {
        lines = this.accounts()
          .filter((a) => a.active)
          .map((a) => ({ accountId: a.id, budgetAmount: ZERO, transferState: 'pending', notes: null }));
      }
      let expectedCashOrigin: 'budget' | 'template' | 'manual' = cashOrigin;
      if (v.expectedCash && normalize(v.expectedCash) !== expectedCash) {
        expectedCash = normalize(v.expectedCash);
        expectedCashOrigin = 'manual';
      }
      const id = uuid();
      this.repos.insertMonth({
        id,
        month: v.month,
        expectedCash,
        notes: null,
        closedAt: null,
        budgetVersionId,
        expectedCashOrigin,
      });
      for (const l of lines) this.repos.upsertAllocation(id, { origin: 'template', ...l });
      this.repos.audit('create', 'month', id, null, { month: v.month, source: v.source, budgetVersionId });
      return id;
    });
  }

  updateMonth(monthId: string, patch: { expectedCash?: Money; notes?: string | null }) {
    return this.mutate('Edit month', () => {
      const m = this.assertOpen(monthId);
      const after = { ...m, ...patch };
      if (patch.expectedCash !== undefined) {
        after.expectedCash = normalize(parse(ProfileInput.shape.expectedCash, patch.expectedCash));
        // An explicit edit is an override; it never writes back to the budget.
        if (after.expectedCash !== m.expectedCash) after.expectedCashOrigin = 'manual';
      }
      this.repos.updateMonth(after);
      this.repos.audit('update', 'month', monthId, m, after);
    });
  }

  setAllocation(
    monthId: string,
    accountId: string,
    patch: { budgetAmount?: Money; notes?: string | null; transferState?: TransferState },
  ) {
    return this.mutate('Edit allocation', () => {
      this.assertOpen(monthId);
      const current: AllocationLine = this.repos
        .listAllocations(monthId)
        .find((a) => a.accountId === accountId) ?? {
        accountId,
        budgetAmount: ZERO,
        transferState: 'pending' as TransferState,
        notes: null,
      };
      const budgetAmount =
        patch.budgetAmount !== undefined
          ? normalize(parse(ProfileInput.shape.expectedCash, patch.budgetAmount))
          : current.budgetAmount;
      const month = this.repos.getMonth(monthId)!;
      const amountChanged = budgetAmount !== normalize(current.budgetAmount);
      const next: AllocationLine = {
        accountId,
        budgetAmount,
        transferState: patch.transferState ?? current.transferState,
        notes: patch.notes !== undefined ? patch.notes || null : current.notes,
        plannedAmount: current.plannedAmount ?? null,
        // A manual change to a budget-driven month is an explicit override; the budget is not touched.
        origin: amountChanged && month.budgetVersionId ? 'manual_override' : (current.origin ?? null),
      };
      this.repos.upsertAllocation(monthId, next);
      this.repos.audit('update', 'allocation', `${monthId}:${accountId}`, current, next);
    });
  }

  /**
   * Compare an open, budget-driven month with a budget version (default: the
   * active one). Archival months and months without a budget have no diff.
   */
  budgetDiff(
    monthId: string,
    versionId?: string,
    opts: { resetOverrides?: boolean } = {},
  ):
    | (BudgetDiff & {
        versionId: string;
        versionLabel: string;
        monthVersionId: string | null;
        /** A refresh (with these options) would change amounts, expected cash or the linked version. */
        needsRefresh: boolean;
        /** Kept manual values that differ from the budget (informational). */
        overrides: { accountId: string; current: Money; proposed: Money }[];
        cashOverride: { current: Money; proposed: Money } | null;
      })
    | null {
    const m = this.repos.getMonth(monthId);
    if (!m) throw new TreasuryError('Month not found', 'not_found');
    if (m.expectedCashOrigin === 'import') return null;
    const version = versionId ? this.budget.repos.getVersion(versionId) : this.budget.activeVersion();
    if (!version || version.detailLevel !== 'full') return null;
    const plan = this.budget.compute(version.id);
    const allocations = this.repos.listAllocations(monthId).map((a) => ({
      accountId: a.accountId,
      budgetAmount: a.budgetAmount,
      plannedAmount: a.plannedAmount ?? null,
      origin: a.origin ?? null,
      transferState: a.transferState,
    }));
    const diff = diffMonthAgainstBudget(m.expectedCash, allocations, plan.budget, opts);
    const keepCash = m.expectedCashOrigin === 'manual' && !opts.resetOverrides;
    const cashAfter = keepCash ? diff.expectedCash.current : diff.expectedCash.proposed;
    return {
      ...diff,
      versionId: version.id,
      versionLabel: version.label,
      monthVersionId: m.budgetVersionId ?? null,
      needsRefresh:
        cashAfter !== diff.expectedCash.current ||
        diff.rows.some((r) => r.after !== r.current) ||
        m.budgetVersionId !== version.id,
      overrides: diff.rows
        .filter((r) => r.overridden && r.changed)
        .map((r) => ({ accountId: r.accountId, current: r.current, proposed: r.proposed })),
      cashOverride:
        keepCash && diff.expectedCash.changed
          ? { current: diff.expectedCash.current, proposed: diff.expectedCash.proposed }
          : null,
    };
  }

  /**
   * Explicit, previewed refresh of an open month's planned funding from a
   * budget version. Overrides are kept unless `resetOverrides`; lines marked
   * Done whose amount changes return to Pending. Never creates postings.
   */
  refreshMonthFromBudget(monthId: string, opts: { versionId?: string; resetOverrides?: boolean } = {}) {
    return this.mutate('Refresh allocations from budget', () => {
      const m = this.assertOpen(monthId);
      if (m.expectedCashOrigin === 'import')
        throw new TreasuryError('Archival imported months are not linked to budgets.', 'archival');
      const version = opts.versionId
        ? this.budget.repos.getVersion(opts.versionId)
        : this.budget.activeVersion();
      if (!version) throw new TreasuryError('There is no active budget.', 'no_budget');
      const plan = this.budget.compute(version.id);
      if (plan.budget.issues.length)
        throw new TreasuryError(
          `Budget ${version.label} needs attention: ${plan.budget.issues.join(' ')}`,
          'invalid_budget',
        );
      const current = this.repos.listAllocations(monthId);
      const diff = diffMonthAgainstBudget(
        m.expectedCash,
        current.map((a) => ({
          accountId: a.accountId,
          budgetAmount: a.budgetAmount,
          plannedAmount: a.plannedAmount ?? null,
          origin: a.origin ?? null,
          transferState: a.transferState,
        })),
        plan.budget,
        { resetOverrides: opts.resetOverrides },
      );
      for (const row of diff.rows) {
        const cur = current.find((a) => a.accountId === row.accountId);
        const keepOverride = row.overridden && !opts.resetOverrides;
        this.repos.upsertAllocation(monthId, {
          accountId: row.accountId,
          budgetAmount: row.after,
          plannedAmount: row.proposed,
          origin: keepOverride ? 'manual_override' : 'budget',
          transferState: row.resetsDone ? 'pending' : (cur?.transferState ?? 'pending'),
          notes: cur?.notes ?? null,
        });
      }
      const keepCash = m.expectedCashOrigin === 'manual' && !opts.resetOverrides;
      const after = {
        ...m,
        expectedCash: keepCash ? m.expectedCash : plan.payroll.takeHome,
        expectedCashOrigin: keepCash ? ('manual' as const) : ('budget' as const),
        budgetVersionId: version.id,
      };
      this.repos.updateMonth(after);
      this.budget.lockVersion(version.id);
      this.repos.audit(
        'refresh',
        'month',
        monthId,
        { expectedCash: m.expectedCash, budgetVersionId: m.budgetVersionId, allocations: current },
        { diff, versionId: version.id },
        `Refreshed from budget ${version.label}`,
      );
    });
  }

  setTransferState(monthId: string, accountId: string, state: TransferState) {
    return this.setAllocation(monthId, accountId, { transferState: state });
  }

  private ensureAllocationLines(monthId: string, accountIds: string[]) {
    const existing = new Set(this.repos.listAllocations(monthId).map((a) => a.accountId));
    for (const id of accountIds) {
      if (!existing.has(id))
        this.repos.upsertAllocation(monthId, {
          accountId: id,
          budgetAmount: ZERO,
          transferState: 'pending',
          notes: null,
        });
    }
  }

  addTransfer(monthId: string, input: z.input<typeof TransferInputSchema>): EntryView {
    const v = parse(TransferInputSchema, input);
    const id = this.mutate('Add transfer', () => {
      this.assertOpen(monthId);
      const entry: JournalEntry = {
        id: uuid(),
        entryDate: v.entryDate,
        loanId: v.loanId?.trim() || null,
        description: v.description,
        notes: v.notes,
        sourceKind: 'user',
        draftReason: null,
        postings: [
          {
            id: uuid(),
            accountId: v.fromAccountId,
            amount: normalize(`-${normalize(v.amount)}`),
            position: 0,
          },
          { id: uuid(), accountId: v.toAccountId, amount: normalize(v.amount), position: 1 },
        ],
      };
      this.repos.insertEntry(monthId, entry, this.repos.nextEntryPosition(monthId));
      this.ensureAllocationLines(monthId, [v.fromAccountId, v.toAccountId]);
      this.repos.audit('create', 'journal_entry', entry.id, null, entry);
      return entry.id;
    });
    return this.monthView(monthId).entries.find((e) => e.entry.id === id)!;
  }

  updateTransfer(entryId: string, input: z.input<typeof TransferInputSchema>) {
    const v = parse(TransferInputSchema, input);
    return this.mutate('Edit transfer', () => {
      const before = this.repos.getEntry(entryId);
      if (!before) throw new TreasuryError('Entry not found', 'not_found');
      this.assertOpen(before.monthlyCycleId);
      const after: JournalEntry = {
        ...before,
        entryDate: v.entryDate,
        loanId: v.loanId?.trim() || null,
        description: v.description,
        notes: v.notes,
        draftReason: null,
        postings: [
          {
            id: uuid(),
            accountId: v.fromAccountId,
            amount: normalize(`-${normalize(v.amount)}`),
            position: 0,
          },
          { id: uuid(), accountId: v.toAccountId, amount: normalize(v.amount), position: 1 },
        ],
      };
      this.repos.updateEntry(after);
      this.ensureAllocationLines(before.monthlyCycleId, [v.fromAccountId, v.toAccountId]);
      this.repos.audit('update', 'journal_entry', entryId, before, after);
    });
  }

  addAdvancedEntry(monthId: string, input: z.input<typeof AdvancedEntryInput>): string {
    const v = parse(AdvancedEntryInput, input);
    return this.mutate('Add multi-posting entry', () => {
      this.assertOpen(monthId);
      const entry: JournalEntry = {
        id: uuid(),
        entryDate: v.entryDate,
        loanId: v.loanId,
        description: v.description,
        notes: v.notes,
        sourceKind: 'user',
        draftReason: null,
        postings: v.postings.map((p, i) => ({
          id: uuid(),
          accountId: p.accountId,
          amount: normalize(p.amount),
          position: i,
        })),
      };
      this.repos.insertEntry(monthId, entry, this.repos.nextEntryPosition(monthId));
      this.ensureAllocationLines(
        monthId,
        v.postings.map((p) => p.accountId),
      );
      this.repos.audit('create', 'journal_entry', entry.id, null, entry);
      return entry.id;
    });
  }

  updateAdvancedEntry(entryId: string, input: z.input<typeof AdvancedEntryInput>) {
    const v = parse(AdvancedEntryInput, input);
    return this.mutate('Edit multi-posting entry', () => {
      const before = this.repos.getEntry(entryId);
      if (!before) throw new TreasuryError('Entry not found', 'not_found');
      this.assertOpen(before.monthlyCycleId);
      const after: JournalEntry = {
        ...before,
        entryDate: v.entryDate,
        loanId: v.loanId,
        description: v.description,
        notes: v.notes,
        draftReason: null,
        postings: v.postings.map((p, i) => ({
          id: uuid(),
          accountId: p.accountId,
          amount: normalize(p.amount),
          position: i,
        })),
      };
      this.repos.updateEntry(after);
      this.ensureAllocationLines(
        before.monthlyCycleId,
        v.postings.map((p) => p.accountId),
      );
      this.repos.audit('update', 'journal_entry', entryId, before, after);
    });
  }

  deleteEntry(entryId: string, opts: { confirmImported?: boolean } = {}) {
    return this.mutate('Delete journal entry', () => {
      const e = this.repos.getEntry(entryId);
      if (!e) throw new TreasuryError('Entry not found', 'not_found');
      this.assertOpen(e.monthlyCycleId);
      if (e.importRunId && !opts.confirmImported)
        throw new TreasuryError(
          'This entry was imported from the workbook. Confirm to delete imported history.',
          'confirm_required',
        );
      this.repos.deleteEntry(entryId);
      this.repos.audit('delete', 'journal_entry', entryId, e, null);
    });
  }

  closeMonth(monthId: string, overrideNote?: string) {
    return this.mutate('Close month', () => {
      const m = this.assertOpen(monthId);
      const r = this.computeFor(m);
      if (r.status === 'REVIEW' && !overrideNote?.trim()) {
        throw new TreasuryError(
          `${m.month} still needs review: ${r.issues
            .filter((i) => i.blocking)
            .map((i) => i.message)
            .join('; ')}`,
          'review',
        );
      }
      const after = {
        ...m,
        closedAt: new Date().toISOString(),
        closeOverrideNote: r.status === 'REVIEW' ? overrideNote!.trim() : null,
      };
      this.repos.updateMonth(after);
      this.repos.audit(
        'close',
        'month',
        monthId,
        m,
        after,
        after.closeOverrideNote ? `Closed with Review override: ${after.closeOverrideNote}` : null,
      );
    });
  }

  reopenMonth(monthId: string) {
    return this.mutate('Reopen month', () => {
      const m = this.repos.getMonth(monthId);
      if (!m) throw new TreasuryError('Month not found', 'not_found');
      if (!m.closedAt) return;
      const after = { ...m, closedAt: null, closeOverrideNote: null };
      this.repos.updateMonth(after);
      this.repos.audit('reopen', 'month', monthId, m, after);
    });
  }

  deleteMonth(monthId: string, opts: { confirmImported?: boolean } = {}) {
    return this.mutate('Delete month', () => {
      const m = this.assertOpen(monthId);
      if (m.importRunId && !opts.confirmImported)
        throw new TreasuryError(
          'This month was imported from the workbook. Confirm to delete imported history.',
          'confirm_required',
        );
      const snapshot = {
        cycle: m,
        allocations: this.repos.listAllocations(monthId),
        entries: this.repos.listEntries(monthId),
      };
      this.repos.deleteMonth(monthId);
      this.repos.audit('delete', 'month', monthId, snapshot, null);
    });
  }

  // ---------------------------------------------------------------- debts
  debtBoard(): DebtBoard {
    const events = this.repos.listAllEvents();
    const byDebt = new Map<string, DebtEvent[]>();
    for (const e of events) byDebt.set(e.debtId, [...(byDebt.get(e.debtId) ?? []), e]);
    const positions = this.repos.listDebts().map((d) => debtPosition(d, byDebt.get(d.id) ?? []));
    const codes = new Map(this.accounts().map((a) => [a.id, a.displayName || a.code]));
    return { positions, summary: summarizeDebts(positions, (id) => codes.get(id) ?? id) };
  }

  debtDetail(debtId: string) {
    const debt = this.repos.getDebt(debtId);
    if (!debt) throw new TreasuryError('Debt not found', 'not_found');
    const position = debtPosition(debt, this.repos.listEvents(debtId));
    const months = new Map(this.repos.listMonths().map((m) => [m.id, m.month]));
    const linkedEntries = this.repos
      .entriesForLoan(debt.loanId)
      .map((entry) => ({ entry, month: months.get(entry.monthlyCycleId) ?? '?' }));
    const eventIds = new Set(position.events.map((e) => e.id));
    const audit = this.repos
      .listAudit(500, 'debt_event')
      .filter((a) => a.entityId && eventIds.has(a.entityId))
      .concat(this.repos.listAudit(100, 'debt', debtId));
    return { position, linkedEntries, audit };
  }

  previewPayment(debtId: string, payment: Money, eventDate = today()) {
    const debt = this.repos.getDebt(debtId);
    if (!debt) throw new TreasuryError('Debt not found', 'not_found');
    const events = this.repos.listEvents(debtId);
    const current = debtPosition(debt, events).currentBalance;
    const change = paymentToChange(current, payment);
    return { change, ...previewChange(debt, events, change, eventDate) };
  }

  previewAdjustment(debtId: string, change: Money, eventDate = today()) {
    const debt = this.repos.getDebt(debtId);
    if (!debt) throw new TreasuryError('Debt not found', 'not_found');
    return { change, ...previewChange(debt, this.repos.listEvents(debtId), change, eventDate) };
  }

  createDebt(input: z.input<typeof NewDebtInput>): Debt {
    const v = parse(NewDebtInput, input);
    return this.mutate(`Create debt ${v.loanId}`, () => {
      if (this.repos.getDebtByLoanId(v.loanId))
        throw new TreasuryError(
          `Loan ID ${v.loanId} already exists. Record a payment or adjustment on it instead.`,
          'duplicate',
        );
      const debt: Debt = {
        id: uuid(),
        loanId: v.loanId,
        openedDate: v.openedDate,
        description: v.description,
        originDebtorAccountId: v.debtorAccountId,
        originCreditorAccountId: v.creditorAccountId,
        terms: v.terms,
      };
      this.repos.insertDebt(debt);
      const ev: DebtEvent = {
        id: uuid(),
        debtId: debt.id,
        eventDate: v.openedDate,
        sequence: this.repos.nextEventSequence(),
        changeAmount: normalize(v.openingChange),
        description: v.description,
        notes: v.notes ?? v.terms,
        journalEntryId: null,
      };
      this.repos.insertEvent(ev);
      this.repos.audit('create', 'debt', debt.id, null, { debt, openingEvent: ev });
      return debt;
    });
  }

  private addEvent(
    debtId: string,
    e: Omit<DebtEvent, 'id' | 'debtId' | 'sequence'>,
    label: string,
  ): DebtEvent {
    return this.mutate(label, () => {
      const debt = this.repos.getDebt(debtId);
      if (!debt) throw new TreasuryError('Debt not found', 'not_found');
      if (e.journalEntryId && this.repos.eventsForJournalEntry(e.journalEntryId).length) {
        throw new TreasuryError('That journal entry is already recorded as a debt event.', 'duplicate');
      }
      const ev: DebtEvent = { ...e, id: uuid(), debtId, sequence: this.repos.nextEventSequence() };
      this.repos.insertEvent(ev);
      this.repos.audit('create', 'debt_event', ev.id, null, ev);
      return ev;
    });
  }

  /** Positive payment amount; stored as the signed change toward zero. */
  recordPayment(debtId: string, input: z.input<typeof PaymentInput>): DebtEvent {
    const v = parse(PaymentInput, input);
    const debt = this.repos.getDebt(debtId);
    if (!debt) throw new TreasuryError('Debt not found', 'not_found');
    const current = debtPosition(debt, this.repos.listEvents(debtId)).currentBalance;
    const change = paymentToChange(current, v.payment);
    return this.addEvent(
      debtId,
      {
        eventDate: v.eventDate,
        changeAmount: change,
        description: v.description ?? 'pmt',
        notes: v.notes,
        journalEntryId: v.journalEntryId ?? null,
      },
      `Payment on ${debt.loanId}`,
    );
  }

  /** Signed change relative to the origin direction. */
  recordAdjustment(debtId: string, input: z.input<typeof AdjustmentInput>): DebtEvent {
    const v = parse(AdjustmentInput, input);
    const debt = this.repos.getDebt(debtId);
    return this.addEvent(
      debtId,
      {
        eventDate: v.eventDate,
        changeAmount: normalize(v.change),
        description: v.description,
        notes: v.notes,
        journalEntryId: v.journalEntryId ?? null,
      },
      `Adjustment on ${debt?.loanId ?? ''}`,
    );
  }

  /** Create the debt event suggested by a monthly transfer that names a Loan ID. */
  recordEntryOnDebt(entryId: string): DebtEvent {
    const entry = this.repos.getEntry(entryId);
    if (!entry) throw new TreasuryError('Entry not found', 'not_found');
    const view = this.monthView(entry.monthlyCycleId).entries.find((e) => e.entry.id === entryId);
    if (!view?.debtSuggestion)
      throw new TreasuryError('This entry does not map to a debt payment.', 'no_suggestion');
    const month = this.repos.getMonth(entry.monthlyCycleId)!;
    return this.addEvent(
      view.debtSuggestion.debtId,
      {
        eventDate: entry.entryDate ?? `${month.month}-01`,
        changeAmount: view.debtSuggestion.change,
        description: entry.description ?? 'pmt',
        notes: `From ${month.month} transfer journal`,
        journalEntryId: entryId,
      },
      `Record ${month.month} transfer on ${view.debtSuggestion.loanId}`,
    );
  }

  editEvent(eventId: string, input: z.input<typeof EventEditInput>) {
    const v = parse(EventEditInput, input);
    return this.mutate('Correct debt event', () => {
      const before = this.repos.getEvent(eventId);
      if (!before) throw new TreasuryError('Event not found', 'not_found');
      const after: DebtEvent = {
        ...before,
        eventDate: v.eventDate,
        changeAmount: normalize(v.changeAmount),
        description: v.description,
        notes: v.notes,
      };
      this.repos.updateEvent(after);
      this.repos.audit('update', 'debt_event', eventId, before, after, 'Event corrected');
    });
  }

  deleteEvent(eventId: string, opts: { confirmImported?: boolean } = {}) {
    return this.mutate('Delete debt event', () => {
      const e = this.repos.getEvent(eventId);
      if (!e) throw new TreasuryError('Event not found', 'not_found');
      if (e.importRunId && !opts.confirmImported)
        throw new TreasuryError(
          'This event was imported from the workbook. Confirm to delete imported history.',
          'confirm_required',
        );
      const remaining = this.repos.listEvents(e.debtId).length;
      if (remaining <= 1)
        throw new TreasuryError('This is the only event on the debt. Delete the debt instead.', 'last_event');
      this.repos.deleteEvent(eventId);
      this.repos.audit('delete', 'debt_event', eventId, e, null);
    });
  }

  deleteDebt(debtId: string, opts: { confirmImported?: boolean } = {}) {
    return this.mutate('Delete debt', () => {
      const d = this.repos.getDebt(debtId);
      if (!d) throw new TreasuryError('Debt not found', 'not_found');
      if (d.importRunId && !opts.confirmImported)
        throw new TreasuryError(
          'This debt was imported from the workbook. Confirm to delete imported history.',
          'confirm_required',
        );
      const events = this.repos.listEvents(debtId);
      this.repos.deleteDebt(debtId);
      this.repos.audit('delete', 'debt', debtId, { debt: d, events }, null);
    });
  }

  updateDebt(debtId: string, patch: Partial<Pick<Debt, 'description' | 'terms' | 'openedDate'>>) {
    return this.mutate('Edit debt', () => {
      const d = this.repos.getDebt(debtId);
      if (!d) throw new TreasuryError('Debt not found', 'not_found');
      const after = { ...d, ...patch };
      this.repos.updateDebt(after);
      this.repos.audit('update', 'debt', debtId, d, after);
    });
  }

  // ---------------------------------------------------------------- import
  existingAliasesForImport() {
    const codes = new Map(this.accounts().map((a) => [a.id, a.code]));
    return this.repos
      .listAliases()
      .map((a) => ({ alias: a.originalText, targetCode: codes.get(a.accountId) ?? '', note: null }));
  }

  committedHashes(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const r of this.repos.listImportRuns())
      if (r.committed) m.set(r.contentHash, [...(m.get(r.contentHash) ?? []), r.id]);
    return m;
  }

  /**
   * Commit an analyzed workbook in one transaction. `replace` removes existing
   * treasury records first (a safety copy of the database is saved beforehand).
   * Any failure rolls back every row written by the import.
   */
  async commitImport(
    plan: ImportPlan,
    mode: 'empty' | 'replace',
    hooks: { failAfter?: string } = {},
  ): Promise<{ runId: string; safetyCopy: string | null }> {
    if (plan.fatal)
      throw new TreasuryError('The workbook has fatal problems and cannot be imported.', 'fatal');
    if (mode === 'empty' && !this.isEmpty())
      throw new TreasuryError(
        'This database already has data. Choose Replace or open a new profile.',
        'not_empty',
      );
    let safetyCopy: string | null = null;
    if (!this.isEmpty()) {
      safetyCopy = await this.saveSafetyCopy('before-import');
    }
    const runId = uuid();
    const startedAt = new Date().toISOString();
    this.mutate(`Import ${plan.filename}`, () => {
      if (mode === 'replace') for (const t of TREASURY_TABLES) this.db.run(`DELETE FROM ${t}`);
      const src = { sourceWorkbook: plan.filename, importRunId: runId };
      this.repos.insertImportRun({
        id: runId,
        filename: plan.filename,
        contentHash: plan.hash,
        recognizerVersion: plan.recognizerVersion,
        mode,
        startedAt,
        completedAt: null,
        committed: false,
        counts: plan.counts,
        controls: plan.controls,
        report: null,
      });

      const idByCode = new Map<string, string>();
      for (const a of plan.accounts) {
        const existing = this.repos.getAccountByCode(a.code);
        if (existing) {
          // Keep the id (budget lines point at it); take the workbook's metadata only where it has some.
          idByCode.set(codeKey(a.code), existing.id);
          this.repos.updateAccount({
            ...existing,
            sortOrder: a.sortOrder,
            description: existing.description ?? a.description,
            displayName: a.displayName ?? existing.displayName,
            active: a.active,
            needsReview: existing.needsReview || a.needsReview,
          });
          continue;
        }
        const id = uuid();
        idByCode.set(codeKey(a.code), id);
        this.repos.insertAccount(
          {
            id,
            code: a.code,
            displayName: a.displayName,
            description: a.description,
            color: a.color,
            sortOrder: a.sortOrder,
            active: a.active,
            needsReview: a.needsReview,
          },
          runId,
        );
      }
      const acct = (code: string) => {
        const id = idByCode.get(codeKey(code));
        if (!id) throw new TreasuryError(`Import references unknown account ${code}`, 'import_integrity');
        return id;
      };
      for (const al of plan.aliases)
        this.repos.insertAlias(
          { alias: al.alias, accountId: acct(al.targetCode), originalText: al.alias },
          al.note,
        );
      if (hooks.failAfter === 'accounts') throw new Error('Injected failure after accounts');

      if (plan.profile) {
        this.repos.upsertProfile({
          id: uuid(),
          name: plan.profile.name,
          expectedCash: plan.profile.expectedCash,
          effectiveFrom: null,
          active: true,
          flaggedOutOfBalance: !isEffectivelyZero(
            sub(sum(plan.profile.lines.map((l) => l.amount)), plan.profile.expectedCash),
          ),
          lines: plan.profile.lines.map((l) => ({ accountId: acct(l.code), amount: l.amount })),
          sourceSheet: plan.profile.sheet,
          sourceRange: plan.profile.range,
          sourceWorkbook: plan.filename,
          importRunId: runId,
        });
      }

      const now = new Date().toISOString();
      for (const m of plan.months) {
        const monthId = uuid();
        this.repos.insertMonth({
          id: monthId,
          month: m.month,
          expectedCash: m.expectedCash,
          notes: m.notes,
          closedAt: m.closed ? now : null,
          expectedCashOrigin: 'import',
          sourceSheet: m.sheet,
          sourceRange: null,
          ...src,
        });
        if (m.closed && m.closeOverrideNote)
          this.repos.updateMonth({
            ...this.repos.getMonth(monthId)!,
            closeOverrideNote: m.closeOverrideNote,
          });
        for (const a of m.allocations) {
          this.repos.upsertAllocation(
            monthId,
            {
              accountId: acct(a.code),
              budgetAmount: a.budgetAmount,
              transferState: a.transferState,
              notes: a.notes,
              origin: 'import',
            },
            a.sourceRange,
          );
        }
        m.entries.forEach((e, i) => {
          this.repos.insertEntry(
            monthId,
            {
              id: uuid(),
              entryDate: e.entryDate,
              loanId: e.loanId,
              description: e.description,
              notes: e.notes,
              sourceKind: e.sourceKind,
              draftReason: e.draftReason,
              sourceSheet: e.sheet,
              sourceRange: e.range,
              ...src,
              postings: e.postings.map((p, j) => ({
                id: uuid(),
                accountId: acct(p.code),
                amount: p.amount,
                position: j,
                originalCode: p.originalCode,
              })),
            },
            i,
          );
        });
      }
      if (hooks.failAfter === 'months') throw new Error('Injected failure after months');

      for (const d of plan.debts) {
        const debtId = uuid();
        this.repos.insertDebt({
          id: debtId,
          loanId: d.loanId,
          openedDate: d.openedDate,
          description: d.description,
          originDebtorAccountId: acct(d.debtorCode),
          originCreditorAccountId: acct(d.creditorCode),
          terms: d.terms,
          sourceSheet: d.sheet,
          sourceRange: d.range,
          ...src,
        });
        for (const e of d.events) {
          this.repos.insertEvent({
            id: uuid(),
            debtId,
            eventDate: e.eventDate,
            sequence: e.sequence,
            changeAmount: e.changeAmount,
            description: e.description,
            notes: e.notes,
            journalEntryId: null,
            sourceDebtor: e.sourceDebtor,
            sourceCreditor: e.sourceCreditor,
            sourceSheet: e.sheet,
            sourceRange: e.range,
            ...src,
          });
        }
      }
      if (hooks.failAfter === 'debts') throw new Error('Injected failure after debts');

      for (const w of plan.warnings) {
        this.repos.insertImportWarning({
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

      // Verify: stored data must reproduce the plan's recalculated controls.
      const board = this.debtBoard();
      const planPositions = plan.debts.length;
      if (this.repos.listDebts().length !== planPositions)
        throw new TreasuryError('Debt count changed during commit', 'import_integrity');
      const planMonthsOk = plan.months.every((m) => {
        const stored = this.repos.getMonthByKey(m.month)!;
        return this.computeFor(stored).journalDifference === computePlannedMonth(m).journalDifference;
      });
      if (!planMonthsOk) throw new TreasuryError('Monthly totals changed during commit', 'import_integrity');
      void board;

      this.db.run('UPDATE import_runs SET committed = 1, completed_at = ? WHERE id = ?', [
        new Date().toISOString(),
        runId,
      ]);
      this.repos.audit(
        'import',
        'import_run',
        runId,
        null,
        { filename: plan.filename, mode, counts: plan.counts },
        safetyCopy ? `Safety copy: ${safetyCopy}` : null,
      );
    });
    await this.flush();
    return { runId, safetyCopy };
  }

  importRuns() {
    return this.repos.listImportRuns();
  }

  importWarnings(runId?: string) {
    return this.repos.listImportWarnings(runId);
  }

  resolveWarning(id: string, resolved: boolean) {
    return this.mutate('Resolve warning', () => this.repos.setWarningResolved(id, resolved), {
      undoable: false,
    });
  }

  // --------------------------------------------------------------- profiles
  /** Save a copy of the current database next to it, named `<profile>~<label>-<timestamp>`. */
  async saveSafetyCopy(label: string): Promise<string> {
    const name = `${this.profile}~${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await this.storage.save(name, this.db.export());
    return name;
  }

  async safetyCopies(): Promise<string[]> {
    return (await this.storage.list()).filter((n) => n.startsWith(`${this.profile}~`));
  }

  async restoreSafetyCopy(name: string) {
    const bytes = await this.storage.load(name);
    if (!bytes) throw new TreasuryError('Safety copy not found', 'not_found');
    await this.saveSafetyCopy('before-restore');
    this.undoStack = [];
    this.db.replace(bytes);
    migrate(this.db);
    this.repos.audit('restore', 'database', null, null, null, `Restored safety copy ${name}`);
    this.schedulePersist();
    this.notify();
    await this.flush();
  }

  /**
   * Replace all data (JSON restore, demo reset). With `undoLabel` the current
   * data stays on the undo stack; otherwise the stack is cleared.
   */
  replaceDatabase(bytes: Uint8Array, note: string, opts: { undoLabel?: string } = {}) {
    if (opts.undoLabel) this.pushUndo(opts.undoLabel, this.db.export());
    else this.undoStack = [];
    this.db.replace(bytes);
    migrate(this.db);
    this.repos.audit('restore', 'database', null, null, null, note);
    this.schedulePersist();
    this.notify();
  }

  auditLog(limit = 200) {
    return this.repos.listAudit(limit);
  }

  // -------------------------------------------------------------- dashboard
  dashboard(monthId?: string | null) {
    const id = monthId ?? this.currentMonthId();
    const month = id ? this.monthView(id) : null;
    const board = this.debtBoard();
    const needsReviewAccounts = this.accounts().filter((a) => a.needsReview);
    const unresolvedWarnings = this.repos
      .listImportWarnings()
      .filter((w) => !w.resolved && (w.severity === 'high' || w.severity === 'fatal'));
    const activeBudget = this.budget.activeVersion();
    let budget: {
      versionId: string;
      label: string;
      takeHome: Money;
      taxDifference: Money | null;
      taxYear: number | null;
    } | null = null;
    if (activeBudget) {
      const view = this.budget.versionView(activeBudget.id);
      budget = {
        versionId: activeBudget.id,
        label: activeBudget.label,
        takeHome: view.payroll!.takeHome,
        taxDifference: view.tax?.total.difference ?? null,
        taxYear: view.tax?.taxYear ?? null,
      };
    }
    const budgetDiff = month && !month.closed ? this.budgetDiff(month.cycle.id) : null;
    return {
      month,
      debts: board.summary,
      needsReviewAccounts,
      unresolvedWarnings,
      budget,
      budgetDiff: budgetDiff?.needsRefresh ? budgetDiff : null,
      recent: this.repos.listAudit(12),
    };
  }
}
