import * as XLSX from 'xlsx';
import {
  PETC_DESCRIPTION,
  SEED_ALIASES,
  canonicalCode,
  codeKey,
  codeNeedsReview,
  type SeedAlias,
} from '@/domain/accounts';
import { debtPosition, summarizeDebts } from '@/domain/debts';
import { computeMonth, legacyJournalStatus } from '@/domain/monthly';
import {
  type Money,
  ZERO,
  abs,
  cmp,
  formatUSD,
  isEffectivelyZero,
  neg,
  normalize,
  sub,
  sum,
} from '@/domain/money';
import {
  MONTH_STATUS_LABEL,
  type Debt,
  type DebtEvent,
  type JournalEntry,
  type TransferState,
} from '@/domain/types';
import {
  type ControlCheck,
  type ImportPlan,
  type PlanWarning,
  type PlannedAccount,
  type PlannedAlias,
  type PlannedAllocation,
  type PlannedDebt,
  type PlannedEntry,
  type PlannedEvent,
  type PlannedMonth,
  type PlannedPosting,
  type SheetRecognition,
  type Severity,
  type AliasApplication,
  RECOGNIZER_VERSION,
} from './plan';
import { Grid, MONTH_SHEET, cellDate, cellMoney, rangeRef, ref, sha256Hex, type CellValue } from './sheet';

/**
 * Seed aliases for one person's workbook, kept out of source control: an optional
 * `reference/seed-aliases.json` (an array of { alias, target, note }) is merged at
 * build time. `reference/` is gitignored; without the file this is empty. The
 * public demo never includes it.
 */
const LOCAL_SEED_ALIASES: SeedAlias[] =
  import.meta.env.MODE === 'demo'
    ? []
    : Object.values(
        import.meta.glob<SeedAlias[]>('/reference/seed-aliases.json', { eager: true, import: 'default' }),
      ).flat();

export interface AnalyzeOptions {
  /** Aliases already in the database (user-edited); merged with the seed aliases. */
  existingAliases?: { alias: string; targetCode: string; note: string | null }[];
  /** Hashes of previously committed imports, for the duplicate warning. */
  committedHashes?: Map<string, string[]>;
}

const money = (v: Money) => formatUSD(v);

/** Account registry used while planning. Keys are case-insensitive codes. */
class Registry {
  accounts = new Map<string, PlannedAccount>();
  aliases = new Map<string, PlannedAlias>();
  applications: AliasApplication[] = [];
  private inferredAliasKeys = new Set<string>();

  constructor(
    aliases: PlannedAlias[],
    inferred: string[],
    private readonly warn: (
      severity: Severity,
      code: string,
      sheet: string | null,
      cell: string | null,
      message: string,
    ) => void,
  ) {
    for (const a of aliases) this.aliases.set(codeKey(a.alias), a);
    for (const k of inferred) this.inferredAliasKeys.add(codeKey(k));
  }

  ensure(code: string, sheet: string): PlannedAccount {
    const key = codeKey(code);
    let a = this.accounts.get(key);
    if (!a) {
      a = {
        code: canonicalCode(code),
        displayName: null,
        description: null,
        color: null,
        sortOrder: this.accounts.size,
        active: true,
        needsReview: codeNeedsReview(canonicalCode(code)),
        discoveredIn: [],
      };
      this.accounts.set(key, a);
    }
    if (!a.discoveredIn.includes(sheet)) a.discoveredIn.push(sheet);
    return a;
  }

  /** Resolve source text to a canonical code, creating the account when new. */
  resolve(text: string, sheet: string, cell: string): { code: string; originalCode: string | null } {
    const key = codeKey(text);
    const alias = this.accounts.has(key) ? undefined : this.aliases.get(key);
    if (alias) {
      const target = this.ensure(alias.targetCode, sheet);
      this.applications.push({ sheet, cell, original: text, code: target.code });
      if (this.inferredAliasKeys.has(key)) {
        this.warn(
          'warning',
          'inferred_alias',
          sheet,
          cell,
          `“${text}” resolved to ${target.code} through the alias table (confirmed mapping; review in Accounts).`,
        );
      }
      return { code: target.code, originalCode: text };
    }
    const a = this.ensure(text, sheet);
    return { code: a.code, originalCode: text === a.code ? null : text };
  }

  /** Resolve without creating (used for comparison-only sheets). */
  peek(text: string): string {
    const key = codeKey(text);
    if (this.accounts.has(key)) return this.accounts.get(key)!.code;
    const alias = this.aliases.get(key);
    return alias ? canonicalCode(alias.targetCode) : canonicalCode(text);
  }
}

export async function analyzeWorkbook(
  bytes: Uint8Array,
  filename: string,
  opts: AnalyzeOptions = {},
): Promise<ImportPlan> {
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
  const plan: ImportPlan = {
    filename,
    hash,
    recognizerVersion: RECOGNIZER_VERSION,
    analyzedAt: new Date().toISOString(),
    sheets: [],
    accounts: [],
    aliases: [],
    aliasApplications: [],
    profile: null,
    months: [],
    debts: [],
    warnings,
    controls,
    counts: {},
    fatal: false,
    duplicateOfRunIds: opts.committedHashes?.get(hash) ?? [],
  };
  if (plan.duplicateOfRunIds.length) {
    warn(
      'high',
      'duplicate_import',
      null,
      null,
      `This workbook (SHA-256 ${hash.slice(0, 12)}…) was already imported and committed. Importing again replaces existing records.`,
    );
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, cellNF: false });
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
  const date1904 = !!wb.Workbook?.WBProps?.date1904;

  // --- aliases: seeds + user-edited aliases already stored ------------------
  const aliasList: PlannedAlias[] = [...SEED_ALIASES, ...LOCAL_SEED_ALIASES].map((a) => ({
    alias: a.alias,
    targetCode: a.target,
    note: a.note,
  }));
  for (const a of opts.existingAliases ?? []) {
    if (!aliasList.some((x) => codeKey(x.alias) === codeKey(a.alias)))
      aliasList.push({ alias: a.alias, targetCode: a.targetCode, note: a.note });
  }
  const reg = new Registry(aliasList, ['Petc.'], warn);

  // --- recognize sheets ---------------------------------------------------
  const grids = wb.SheetNames.map((n) => new Grid(n, wb.Sheets[n]));
  const roles = new Map<string, SheetRecognition>();
  for (const g of grids) roles.set(g.name, recognize(g));
  plan.sheets = grids.map((g) => roles.get(g.name)!);
  for (const s of plan.sheets)
    if (s.role === 'ignored')
      warn(
        'info',
        'ignored_sheet',
        s.name,
        null,
        `Sheet “${s.name}” was not recognized and was left untouched.`,
      );
  const byRole = (role: SheetRecognition['role']) => grids.filter((g) => roles.get(g.name)!.role === role);

  // Accounts table from an application export establishes exact roster/metadata first.
  for (const g of byRole('accounts_table')) parseAccountsTable(g, reg, warn);

  // --- template / overview → allocation profile ------------------------------
  const template = byRole('template')[0];
  const overview = byRole('overview')[0];
  if (template) {
    const templateParsed = parseNormalizedSheet(template, reg, warn, date1904);
    plan.profile = {
      name: 'Current allocations',
      expectedCash: templateParsed.expectedCash ?? sum(templateParsed.summary.map((s) => s.budget)),
      lines: templateParsed.summary.map((s) => ({ code: s.code, amount: s.budget })),
      sheet: template.name,
      range: templateParsed.summaryRange,
    };
    if (templateParsed.entries.length) {
      warn(
        'warning',
        'template_journal_rows',
        template.name,
        null,
        `Monthly Template contains ${templateParsed.entries.length} journal row(s); templates carry allocations only, so these rows were not imported as a month.`,
      );
    }
  }
  const overviewData = overview ? parseOverview(overview, reg) : null;
  if (overviewData && !plan.profile && overviewData.allocations.length) {
    plan.profile = {
      name: 'Current allocations',
      expectedCash: overviewData.expectedCash ?? sum(overviewData.allocations.map((a) => a.amount)),
      lines: overviewData.allocations.map((a) => ({ code: a.code, amount: a.amount })),
      sheet: overview!.name,
      range: null,
    };
  }
  if (overviewData && plan.profile) {
    if (overviewData.expectedCash) {
      control(
        'Overview',
        'Expected monthly cash',
        overviewData.expectedCash,
        plan.profile.expectedCash,
        cmp(overviewData.expectedCash, plan.profile.expectedCash) === 0,
      );
    }
    for (const a of overviewData.allocations) {
      const line = plan.profile.lines.find((l) => l.code === a.code);
      const actual = line?.amount ?? ZERO;
      const pass = isEffectivelyZero(sub(actual, a.amount));
      control('Overview', `Allocation ${a.code}`, a.amount, actual, pass);
      if (!pass)
        warn(
          'warning',
          'overview_allocation_mismatch',
          overview!.name,
          a.cell,
          `Overview shows ${a.code} = ${money(a.amount)} but the Monthly Template has ${money(actual)}.`,
        );
    }
  }

  // --- monthly sheets ------------------------------------------------------
  for (const g of grids) {
    const role = roles.get(g.name)!.role;
    if (role === 'legacy_month') plan.months.push(parseLegacyMonth(g, reg, warn, control));
    else if (role === 'normalized_month')
      plan.months.push(buildNormalizedMonth(g, parseNormalizedSheet(g, reg, warn, date1904), warn, control));
  }
  plan.months.sort((a, b) => a.month.localeCompare(b.month));
  const seenMonths = new Set<string>();
  for (const m of plan.months) {
    if (seenMonths.has(m.month)) {
      warn('fatal', 'duplicate_month', m.sheet, null, `More than one sheet describes ${m.month}.`);
      plan.fatal = true;
    }
    seenMonths.add(m.month);
  }

  // --- ledger ----------------------------------------------------------------
  let sequence = 0;
  for (const g of byRole('ledger')) {
    const debts = parseLedger(g, reg, warn, date1904, () => ++sequence);
    for (const d of debts) {
      if (plan.debts.some((x) => x.loanId === d.loanId)) {
        warn(
          'fatal',
          'duplicate_loan_across_sheets',
          g.name,
          d.range,
          `Loan ID ${d.loanId} appears in more than one ledger sheet.`,
        );
        plan.fatal = true;
      } else plan.debts.push(d);
    }
  }
  if (plan.debts.some((d) => !d.debtorCode || !d.creditorCode)) plan.fatal = true;

  // Application export metadata overrides inferred values.
  for (const g of byRole('debts_table')) applyDebtsTable(g, plan.debts, reg, warn, date1904);
  const monthsMeta = byRole('months_table').flatMap((g) => parseMonthsTable(g));

  // --- lifecycle: closed flags ----------------------------------------------
  if (monthsMeta.length) {
    for (const m of plan.months) {
      const meta = monthsMeta.find((x) => x.month === m.month);
      if (meta) {
        m.notes = meta.notes;
        m.closed = meta.closed;
        m.closeOverrideNote = meta.closeOverrideNote;
        if (meta.expectedCash) m.expectedCash = meta.expectedCash;
      }
    }
  } else {
    // Historical workbook months are closed except the most recent one.
    const latest = plan.months[plan.months.length - 1]?.month;
    for (const m of plan.months) {
      m.closed = m.month !== latest;
      if (m.closed) {
        const status = monthStatusOf(m);
        if (status === 'REVIEW')
          m.closeOverrideNote =
            'Imported as closed workbook history while status was Review; source preserved unchanged.';
      }
    }
  }

  // --- accounts: PETC note, review flags ---------------------------------------
  const petc = reg.accounts.get('PETC');
  if (petc && !petc.description) petc.description = PETC_DESCRIPTION;
  const templateCodes = new Set(plan.profile?.lines.map((l) => l.code) ?? []);
  for (const a of reg.accounts.values()) {
    if (a.needsReview) {
      warn(
        'warning',
        'unknown_code',
        a.discoveredIn[0] ?? null,
        null,
        `Account code “${a.code}” is not a standard identifier. It was preserved as its own account and needs review.`,
      );
    } else if (templateCodes.size && !templateCodes.has(a.code)) {
      warn(
        'info',
        'account_outside_template',
        a.discoveredIn[0] ?? null,
        null,
        `Account ${a.code} is not in the Monthly Template roster; discovered in ${a.discoveredIn.join(', ')}.`,
      );
    }
  }

  // --- debt controls ---------------------------------------------------------
  const positions = plan.debts.map((d) => debtPosition(plannedDebtToDomain(d), plannedEventsToDomain(d)));
  const summary = summarizeDebts(positions);
  const debtSummarySheet = byRole('debt_summary')[0];
  if (debtSummarySheet) compareDebtSummary(debtSummarySheet, summary, reg, warn, control);
  control('Debts', 'Net positions sum to zero', '0', summary.netSum, isEffectivelyZero(summary.netSum));
  if (overviewData) {
    if (overviewData.nonZeroDebts !== null)
      control(
        'Overview',
        'Non-zero debts',
        String(overviewData.nonZeroDebts),
        String(summary.nonZeroCount),
        overviewData.nonZeroDebts === summary.nonZeroCount,
      );
    if (overviewData.totalOutstanding)
      control(
        'Overview',
        'Total outstanding',
        overviewData.totalOutstanding,
        summary.totalOutstanding,
        isEffectivelyZero(sub(overviewData.totalOutstanding, summary.totalOutstanding)),
      );
    if (overviewData.latestReconciliation && plan.months.length) {
      const last = plan.months[plan.months.length - 1];
      const computed =
        last.format === 'legacy_matrix'
          ? legacyJournalStatus(monthJournalDifference(last))
          : MONTH_STATUS_LABEL[monthStatusOf(last)];
      control(
        'Overview',
        `Latest reconciliation (${last.month})`,
        overviewData.latestReconciliation,
        computed,
        overviewData.latestReconciliation.toLowerCase() === computed.toLowerCase(),
      );
    }
  }

  // --- finalize --------------------------------------------------------------
  for (const c of controls) {
    if (
      !c.pass &&
      !warnings.some((w) => w.code === 'control_mismatch' && w.message.startsWith(`${c.group} · ${c.name}`))
    ) {
      warn(
        'high',
        'control_mismatch',
        null,
        null,
        `${c.group} · ${c.name}: workbook ${c.expected ?? '—'}, app ${c.actual}${c.detail ? ` (${c.detail})` : ''}`,
      );
    }
  }
  plan.accounts = [...reg.accounts.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  plan.accounts.forEach((a, i) => (a.sortOrder = i));
  plan.aliases = [...reg.aliases.values()].filter((a) => reg.accounts.has(codeKey(a.targetCode)));
  plan.aliasApplications = reg.applications;
  if (warnings.some((w) => w.severity === 'fatal')) plan.fatal = true;
  if (!plan.sheets.some((s) => s.role !== 'ignored')) {
    warn(
      'fatal',
      'no_recognized_sheets',
      null,
      null,
      'No recognizable treasury sheets were found in this workbook.',
    );
    plan.fatal = true;
  }
  plan.counts = {
    sheets: plan.sheets.length,
    recognizedSheets: plan.sheets.filter((s) => s.role !== 'ignored').length,
    accounts: plan.accounts.length,
    aliases: plan.aliases.length,
    aliasApplications: plan.aliasApplications.length,
    months: plan.months.length,
    monthlyAllocations: plan.months.reduce((n, m) => n + m.allocations.length, 0),
    journalEntries: plan.months.reduce((n, m) => n + m.entries.length, 0),
    journalPostings: plan.months.reduce(
      (n, m) => n + m.entries.reduce((k, e) => k + e.postings.length, 0),
      0,
    ),
    debts: plan.debts.length,
    debtEvents: plan.debts.reduce((n, d) => n + d.events.length, 0),
    profileLines: plan.profile?.lines.length ?? 0,
    warnings: warnings.length,
  };
  return plan;
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

function recognize(g: Grid): SheetRecognition {
  const has = (label: string) => !!g.find((l) => l === label.toLowerCase());
  const normalizedHeader = g.findHeader([
    'Account',
    'Budget allocation',
    'Transfers in',
    'Transfers out',
    'Final transfer',
  ]);
  const journalHeader = g.findHeader(['Date', 'LID', 'Description', 'From account', 'To account', 'Amount']);
  if (normalizedHeader && journalHeader) {
    if (MONTH_SHEET.test(g.name))
      return { name: g.name, role: 'normalized_month', detail: 'Normalized monthly reconciliation' };
    return { name: g.name, role: 'template', detail: 'Monthly Template (allocation profile)' };
  }
  if (g.findHeader(['Loan ID', 'Date', 'Debtor account', 'Creditor account', 'Change'])) {
    return { name: g.name, role: 'ledger', detail: 'Account Ledger (debt events)' };
  }
  if (
    MONTH_SHEET.test(g.name) &&
    g.findHeader(['Description', 'Total']) &&
    g.find((l) => l === 'budget allocation') &&
    g.find((l) => /^x'?fer amount/.test(l))
  ) {
    return { name: g.name, role: 'legacy_month', detail: 'Legacy matrix month' };
  }
  if (g.findHeader(['Account', 'Owed to account', 'Owed by account', 'Net position'])) {
    return { name: g.name, role: 'debt_summary', detail: 'Interco Debt Summary (comparison only)' };
  }
  if (has('expected monthly cash'))
    return { name: g.name, role: 'overview', detail: 'Overview (comparison and allocations)' };
  if (g.findHeader(['Order', 'Code', 'Display name', 'Description', 'Aliases', 'Active'])) {
    return { name: g.name, role: 'accounts_table', detail: 'Account roster (application export)' };
  }
  if (g.findHeader(['Loan ID', 'Opened', 'Origin debtor', 'Origin creditor'])) {
    return { name: g.name, role: 'debts_table', detail: 'Debt origin metadata (application export)' };
  }
  if (g.findHeader(['Month', 'Expected cash', 'Closed', 'Notes'])) {
    return { name: g.name, role: 'months_table', detail: 'Month lifecycle metadata (application export)' };
  }
  if (has('exported by')) return { name: g.name, role: 'export_info', detail: 'Export metadata' };
  return { name: g.name, role: 'ignored', detail: 'Not recognized' };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function valueRight(g: Grid, label: string): { v: CellValue; cell: string } | null {
  const at = g.find((l) => l === label.toLowerCase());
  if (!at) return null;
  return { v: g.v(at.r, at.c + 1), cell: ref(at.r, at.c + 1) };
}

function parseOverview(g: Grid, reg: Registry) {
  const exp = valueRight(g, 'Expected monthly cash');
  const nz = valueRight(g, 'Non-zero debts');
  const tot = valueRight(g, 'Total outstanding');
  const latest = valueRight(g, 'Latest reconciliation');
  const allocations: { code: string; amount: Money; cell: string }[] = [];
  const header = g.findHeader(['Account', 'Budget allocation']);
  if (header) {
    const cA = header.cols.get('account')!;
    const cB = header.cols.get('budget allocation')!;
    for (let r = header.row + 1; r < g.rows; r++) {
      const code = g.text(r, cA);
      if (!code) break;
      const m = cellMoney(g.v(r, cB));
      if (m === 'invalid') continue;
      allocations.push({ code: reg.peek(code), amount: m ?? ZERO, cell: ref(r, cB) });
    }
  }
  const em = exp ? cellMoney(exp.v) : null;
  const tm = tot ? cellMoney(tot.v) : null;
  return {
    expectedCash: em && em !== 'invalid' ? em : null,
    nonZeroDebts: nz && typeof nz.v === 'number' ? nz.v : null,
    totalOutstanding: tm && tm !== 'invalid' ? tm : null,
    latestReconciliation: latest && typeof latest.v === 'string' ? latest.v : null,
    allocations,
  };
}

// ---------------------------------------------------------------------------
// Normalized monthly layout (Monthly Template and application exports)
// ---------------------------------------------------------------------------

interface NormalizedSheet {
  monthText: string | null;
  expectedCash: Money | null;
  expectedCashCell: string | null;
  summary: {
    code: string;
    budget: Money;
    transferred: string | null;
    notes: string | null;
    row: number;
    cell: string;
  }[];
  summaryRange: string | null;
  entries: PlannedEntry[];
  workbook: Record<string, CellValue>;
}

function parseNormalizedSheet(
  g: Grid,
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  date1904: boolean,
): NormalizedSheet {
  const monthCell = valueRight(g, 'Month');
  const expected = valueRight(g, 'Expected cash');
  const expectedCash = expected ? cellMoney(expected.v) : null;
  if (expectedCash === 'invalid')
    warn('high', 'invalid_expected_cash', g.name, expected!.cell, 'Expected cash is not a number.');

  const workbook: Record<string, CellValue> = {};
  for (const label of [
    'Allocation difference',
    'Journal difference',
    'Final transfer difference',
    'Journal rows to fix',
    'Negative transfers',
    'Status',
  ]) {
    const v = valueRight(g, label);
    if (v) workbook[label] = v.v;
  }

  const sh = g.findHeader([
    'Account',
    'Budget allocation',
    'Transfers in',
    'Transfers out',
    'Final transfer',
  ])!;
  const jh = g.findHeader(
    ['Date', 'LID', 'Description', 'From account', 'To account', 'Amount'],
    sh.row + 1,
  )!;
  const cAcct = sh.cols.get('account')!;
  const cBudget = sh.cols.get('budget allocation')!;
  const cTransferred = [...Array(g.cols).keys()].find((c) => g.label(sh.row, c) === 'transferred?') ?? null;
  const cNotes = [...Array(g.cols).keys()].find((c) => c > cBudget && g.label(sh.row, c) === 'notes') ?? null;

  const summary: NormalizedSheet['summary'] = [];
  let lastSummaryRow = sh.row;
  for (let r = sh.row + 1; r < jh.row; r++) {
    const raw = g.text(r, cAcct);
    if (!raw) continue;
    if (raw.trim().toLowerCase() === 'total') break;
    lastSummaryRow = r;
    const res = reg.resolve(raw, g.name, ref(r, cAcct));
    const b = cellMoney(g.v(r, cBudget));
    if (b === 'invalid')
      warn(
        'high',
        'invalid_amount',
        g.name,
        ref(r, cBudget),
        `Budget allocation for ${res.code} is not a number; imported as 0.`,
      );
    summary.push({
      code: res.code,
      budget: b === null || b === 'invalid' ? ZERO : b,
      transferred: cTransferred !== null ? g.text(r, cTransferred) : null,
      notes: cNotes !== null ? g.text(r, cNotes) : null,
      row: r,
      cell: ref(r, cBudget),
    });
  }

  const col = (name: string) => jh.cols.get(name)!;
  const cNotesJ =
    [...Array(g.cols).keys()].find((c) => c > col('amount') && g.label(jh.row, c) === 'notes') ?? null;
  const cCheck = [...Array(g.cols).keys()].find((c) => g.label(jh.row, c) === 'row check') ?? null;
  const cKind = [...Array(g.cols).keys()].find((c) => g.label(jh.row, c) === 'source kind') ?? null;
  const cPos = [...Array(g.cols).keys()].find((c) => g.label(jh.row, c) === 'position') ?? null;
  const positions = new Map<PlannedEntry, number>();
  const advancedTitle = g.find((l) => l === 'advanced postings', jh.row + 1);
  const journalEnd = advancedTitle ? advancedTitle.r : g.rows;
  const entries: PlannedEntry[] = [];
  for (let r = jh.row + 1; r < journalEnd; r++) {
    const dateV = g.v(r, col('date'));
    const lid = g.text(r, col('lid'));
    const desc = g.text(r, col('description'));
    const fromT = g.text(r, col('from account'));
    const toT = g.text(r, col('to account'));
    const amtV = g.v(r, col('amount'));
    const notes = cNotesJ !== null ? g.text(r, cNotesJ) : null;
    if ([dateV, lid, desc, fromT, toT, amtV, notes].every((v) => v === null)) continue;
    const range = rangeRef(r, 0, r, cCheck ?? cNotesJ ?? col('amount'));
    const date = cellDate(dateV, date1904);
    if (date === 'invalid')
      warn(
        'warning',
        'invalid_date',
        g.name,
        ref(r, col('date')),
        `Date “${String(dateV)}” could not be read; entry imported without a date.`,
      );
    const amount = cellMoney(amtV);
    const from = fromT ? reg.resolve(fromT, g.name, ref(r, col('from account'))) : null;
    const to = toT ? reg.resolve(toT, g.name, ref(r, col('to account'))) : null;

    // Same rule as the workbook's Row check.
    let reason: string | null = null;
    if (!desc || !fromT || !toT || amtV === null) reason = 'Incomplete';
    else if (amount === 'invalid') reason = 'Amount is not a number';
    else if (from!.code === to!.code) reason = 'Same account';
    else if (amount === null || cmp(amount, ZERO) <= 0) reason = 'Amount must be > 0';

    const postings: PlannedPosting[] = [];
    if (amount && amount !== 'invalid') {
      if (from) postings.push({ code: from.code, amount: neg(amount), originalCode: from.originalCode });
      if (to) postings.push({ code: to.code, amount, originalCode: to.originalCode });
    }
    if (reason) {
      warn(
        'warning',
        'invalid_transfer_row',
        g.name,
        range,
        `Journal row ${r + 1} is invalid (${reason}); kept as a flagged draft.`,
      );
    }
    const sourceCheck = cCheck !== null ? g.text(r, cCheck) : null;
    const computedCheck = reason ?? 'OK';
    if (sourceCheck && sourceCheck !== computedCheck && !(reason === 'Amount is not a number')) {
      warn(
        'warning',
        'row_check_mismatch',
        g.name,
        ref(r, cCheck!),
        `Row check shows “${sourceCheck}” but the app calculates “${computedCheck}”.`,
      );
    }
    const kindText = cKind !== null ? g.text(r, cKind) : null;
    const entry: PlannedEntry = {
      entryDate: date === 'invalid' ? null : date,
      loanId: lid?.trim() || null,
      description: desc,
      notes,
      sourceKind: kindText === 'user' || kindText === 'legacy_matrix' ? kindText : 'normalized_workbook',
      draftReason: reason,
      postings,
      sheet: g.name,
      range,
    };
    const pos = cPos !== null ? g.v(r, cPos) : null;
    if (typeof pos === 'number') positions.set(entry, pos);
    entries.push(entry);
  }

  // Multi-posting and unbalanced entries written by the application's exporter.
  if (advancedTitle) {
    const ah = g.findHeader(['Entry', 'Date', 'LID', 'Description', 'Account', 'Amount'], advancedTitle.r);
    if (ah) {
      const c = (n: string) => ah.cols.get(n)!;
      const cN =
        [...Array(g.cols).keys()].find((k) => k > c('amount') && g.label(ah.row, k) === 'notes') ?? null;
      const byRef = new Map<string, PlannedEntry>();
      for (let r = ah.row + 1; r < g.rows; r++) {
        const key = g.text(r, c('entry'));
        if (!key) continue;
        let e = byRef.get(key);
        if (!e) {
          const d = cellDate(g.v(r, c('date')), date1904);
          e = {
            entryDate: d === 'invalid' ? null : d,
            loanId: g.text(r, c('lid'))?.trim() || null,
            description: g.text(r, c('description')),
            notes: cN !== null ? g.text(r, cN) : null,
            sourceKind: 'legacy_matrix',
            draftReason: null,
            postings: [],
            sheet: g.name,
            range: rangeRef(r, 0, r, cN ?? c('amount')),
          };
          byRef.set(key, e);
          entries.push(e);
        } else {
          e.range = `${e.range.split(':')[0]}:${ref(r, cN ?? c('amount'))}`;
        }
        const acct = g.text(r, c('account'));
        const amt = cellMoney(g.v(r, c('amount')));
        if (!acct || amt === null || amt === 'invalid') {
          warn(
            'high',
            'invalid_posting',
            g.name,
            ref(r, c('amount')),
            `Advanced posting row ${r + 1} lacks an account or numeric amount.`,
          );
          e.draftReason = 'Incomplete posting';
          continue;
        }
        const res = reg.resolve(acct, g.name, ref(r, c('account')));
        e.postings.push({ code: res.code, amount: amt, originalCode: res.originalCode });
      }
      // Preserve the original source kind and draft flag when present.
      const kinds = [...Array(g.cols).keys()].find((k) => g.label(ah.row, k) === 'kind');
      const drafts = [...Array(g.cols).keys()].find((k) => g.label(ah.row, k) === 'draft reason');
      const aPos = [...Array(g.cols).keys()].find((k) => g.label(ah.row, k) === 'position');
      for (let r = ah.row + 1; r < g.rows; r++) {
        const key = g.text(r, c('entry'));
        const e = key ? byRef.get(key) : undefined;
        if (!e) continue;
        const kind = kinds !== undefined ? g.text(r, kinds) : null;
        if (kind === 'user' || kind === 'normalized_workbook' || kind === 'legacy_matrix')
          e.sourceKind = kind;
        const draft = drafts !== undefined ? g.text(r, drafts) : null;
        if (draft) e.draftReason = draft;
        const pos = aPos !== undefined ? g.v(r, aPos) : null;
        if (typeof pos === 'number') positions.set(e, pos);
      }
    }
  }

  // Application exports record each entry's original position across both sections.
  if (positions.size === entries.length && entries.length > 0) {
    entries.sort((a, b) => positions.get(a)! - positions.get(b)!);
  }

  return {
    monthText: monthCell ? (monthCell.v === null ? null : String(monthCell.v)) : null,
    expectedCash: expectedCash === 'invalid' ? null : expectedCash,
    expectedCashCell: expected?.cell ?? null,
    summary,
    summaryRange: summary.length ? rangeRef(sh.row + 1, cAcct, lastSummaryRow, cNotes ?? cBudget) : null,
    entries,
    workbook,
  };
}

function transferStateFrom(text: string | null): { state: TransferState; unknown: boolean } {
  if (!text) return { state: 'pending', unknown: false };
  const t = text.trim().toLowerCase();
  if (t === 'done' || t === 'x' || t === 'yes') return { state: 'done', unknown: false };
  if (t === 'not required' || t === 'n/a' || t === 'na') return { state: 'not_required', unknown: false };
  if (t === 'pending') return { state: 'pending', unknown: false };
  return { state: 'pending', unknown: true };
}

function buildNormalizedMonth(
  g: Grid,
  p: NormalizedSheet,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  control: (
    group: string,
    name: string,
    expected: string | null,
    actual: string,
    pass: boolean,
    detail?: string,
  ) => void,
): PlannedMonth {
  const month = g.name;
  if (p.monthText && p.monthText.slice(0, 7) !== month) {
    warn(
      'warning',
      'month_label_mismatch',
      g.name,
      null,
      `Sheet ${g.name} states month “${p.monthText}”; the sheet name was used.`,
    );
  }
  const notes: string[] = [];
  const explicit = new Set<string>();
  const allocations: PlannedAllocation[] = p.summary.map((s) => {
    const ts = transferStateFrom(s.transferred);
    if (s.transferred && !ts.unknown) explicit.add(s.code);
    let n = s.notes;
    if (ts.unknown) {
      warn(
        'warning',
        'ambiguous_confirmation',
        g.name,
        s.cell,
        `Transferred? value “${s.transferred}” for ${s.code} is not recognized; kept as pending and preserved in notes.`,
      );
      n = [n, `Source Transferred?: ${s.transferred}`].filter(Boolean).join(' · ');
    }
    return { code: s.code, budgetAmount: s.budget, transferState: ts.state, notes: n, sourceRange: s.cell };
  });
  const expectedCash = p.expectedCash ?? sum(allocations.map((a) => a.budgetAmount));
  if (!p.expectedCash)
    warn(
      'warning',
      'missing_expected_cash',
      g.name,
      p.expectedCashCell,
      'Expected cash is blank; the allocation total was used.',
    );
  const m: PlannedMonth = {
    month,
    expectedCash,
    notes: notes.length ? notes.join('\n') : null,
    closed: false,
    closeOverrideNote: null,
    sheet: g.name,
    format: 'normalized',
    allocations,
    entries: p.entries,
  };
  applyZeroRule(m, explicit);
  const r = computePlannedMonth(m);
  const cmpCtl = (label: string, actual: Money) => {
    const v = p.workbook[label];
    if (v === undefined) return;
    const exp = cellMoney(v as CellValue);
    if (exp === null || exp === 'invalid') return;
    control(`Month ${month}`, label, exp, actual, isEffectivelyZero(sub(exp, actual)));
  };
  cmpCtl('Allocation difference', r.allocationDifference);
  cmpCtl('Journal difference', r.journalDifference);
  cmpCtl('Final transfer difference', r.finalTransferDifference);
  if (typeof p.workbook['Status'] === 'string') {
    const computed = MONTH_STATUS_LABEL[r.status];
    control(
      `Month ${month}`,
      'Status',
      String(p.workbook['Status']),
      computed,
      String(p.workbook['Status']).toLowerCase() === computed.toLowerCase(),
    );
  }
  return m;
}

// ---------------------------------------------------------------------------
// Legacy matrix months
// ---------------------------------------------------------------------------

function parseLegacyMonth(
  g: Grid,
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  control: (
    group: string,
    name: string,
    expected: string | null,
    actual: string,
    pass: boolean,
    detail?: string,
  ) => void,
): PlannedMonth {
  const header = g.findHeader(['Description', 'Total'])!;
  const cDesc = header.cols.get('description')!;
  const cTotal = header.cols.get('total')!;
  const cLid = [...Array(g.cols).keys()].find((c) => g.label(header.row, c) === 'lid') ?? null;
  const firstAcct = (cLid ?? cDesc) + 1;
  const accountCols: { c: number; code: string; original: string | null }[] = [];
  for (let c = firstAcct; c < cTotal; c++) {
    const t = g.text(header.row, c);
    if (!t) continue;
    const res = reg.resolve(t, g.name, ref(header.row, c));
    accountCols.push({ c, code: res.code, original: res.originalCode });
  }

  let budgetRow = -1;
  let xferRow = -1;
  for (let r = header.row + 1; r < g.rows; r++) {
    const l = g.label(r, cDesc);
    if (budgetRow < 0 && l === 'budget allocation') budgetRow = r;
    if (xferRow < 0 && /^x'?fer amount/.test(l)) xferRow = r;
  }

  // Free-text notes above the header (other than title and controls).
  const notes: string[] = [];
  for (let r = 0; r < header.row; r++) {
    const t = g.text(r, 0);
    if (!t) continue;
    const l = t.toLowerCase();
    if (l.endsWith('cash flow reconciliation') || l === 'journal difference') continue;
    notes.push(t);
  }

  const allocations: PlannedAllocation[] = accountCols.map(({ c, code }) => {
    const m = cellMoney(g.v(budgetRow, c));
    if (m === 'invalid')
      warn(
        'high',
        'invalid_amount',
        g.name,
        ref(budgetRow, c),
        `Budget allocation for ${code} is not a number; imported as 0.`,
      );
    return {
      code,
      budgetAmount: m === null || m === 'invalid' ? ZERO : m,
      transferState: 'pending',
      notes: null,
      sourceRange: ref(budgetRow, c),
    };
  });

  const entries: PlannedEntry[] = [];
  const memoRows: string[] = [];
  for (let r = budgetRow + 1; r < xferRow; r++) {
    const desc = g.text(r, cDesc);
    const lid = cLid !== null ? g.text(r, cLid) : null;
    const postings: PlannedPosting[] = [];
    for (const { c, code, original } of accountCols) {
      const v = g.v(r, c);
      const m = cellMoney(v);
      if (m === null) continue;
      if (m === 'invalid') {
        warn(
          'high',
          'invalid_amount',
          g.name,
          ref(r, c),
          `Cell value “${String(v)}” is not a number and was not imported as a posting.`,
        );
        continue;
      }
      if (m === ZERO) continue;
      postings.push({ code, amount: m, originalCode: original });
    }
    if (postings.length === 0) {
      if (desc || lid) memoRows.push(`row ${r + 1}${lid ? ` (LID ${lid})` : ''}${desc ? ` “${desc}”` : ''}`);
      continue;
    }
    const range = rangeRef(r, cDesc, r, cTotal);
    const diff = sum(postings.map((p) => p.amount));
    const shown = cellMoney(g.v(r, cTotal));
    if (shown && shown !== 'invalid' && !isEffectivelyZero(sub(shown, diff))) {
      warn(
        'warning',
        'row_total_mismatch',
        g.name,
        ref(r, cTotal),
        `Row total shows ${money(shown)} but postings sum to ${money(diff)}.`,
      );
    }
    if (!isEffectivelyZero(diff)) {
      warn(
        'warning',
        'unbalanced_entry',
        g.name,
        range,
        `Row ${r + 1}${lid ? ` (LID ${lid})` : ''} is out of balance by ${money(diff)} (exact ${diff}). All postings were preserved; no balancing entry was added.`,
      );
    }
    if (postings.length === 1) {
      warn(
        'warning',
        'single_posting',
        g.name,
        range,
        `Row ${r + 1} has a single posting and is flagged for review.`,
      );
    }
    entries.push({
      entryDate: null,
      loanId: lid?.trim() || null,
      description: desc,
      notes: null,
      sourceKind: 'legacy_matrix',
      draftReason: null,
      postings,
      sheet: g.name,
      range,
    });
  }
  if (memoRows.length) {
    warn(
      'info',
      'memo_rows',
      g.name,
      null,
      `Rows with a label but no postings were not imported as journal entries: ${memoRows.join('; ')}.`,
    );
  }
  if (entries.length) {
    warn(
      'info',
      'month_date_fallback',
      g.name,
      null,
      `${entries.length} legacy row(s) have no date; the sheet month ${g.name} is used as their date.`,
    );
  }

  // Confirmation and legacy check rows after the X'fer Amount row.
  const done = new Set<string>();
  for (let r = xferRow + 1; r < g.rows; r++) {
    const l = g.label(r, cDesc);
    if (!l) continue;
    if (/^transfer confirmation/.test(l)) {
      for (const { c, code } of accountCols) {
        const t = g.text(r, c);
        if (!t) continue;
        if (t.trim().toLowerCase() === 'x') done.add(code);
        else
          warn(
            'warning',
            'ambiguous_confirmation',
            g.name,
            ref(r, c),
            `Confirmation marker “${t}” for ${code} is not “x”; treated as not confirmed.`,
          );
      }
    } else {
      const vals = accountCols
        .map(({ c, code }) => ({ code, v: g.v(r, c) }))
        .filter((x) => x.v !== null)
        .map((x) => `${x.code} ${typeof x.v === 'number' ? normalize(cellMoney(x.v) as Money) : x.v}`);
      notes.push(`${g.text(r, cDesc)}: ${vals.join('; ')}`);
      warn(
        'info',
        'legacy_check_row',
        g.name,
        rangeRef(r, cDesc, r, cTotal),
        `“${g.text(r, cDesc)}” row preserved in month notes (not a journal entry).`,
      );
    }
  }
  for (const a of allocations) if (done.has(a.code)) a.transferState = 'done';

  const expectedCash = sum(allocations.map((a) => a.budgetAmount));
  const m: PlannedMonth = {
    month: g.name,
    expectedCash,
    notes: notes.length ? notes.join('\n') : null,
    closed: false,
    closeOverrideNote: null,
    sheet: g.name,
    format: 'legacy_matrix',
    allocations,
    entries,
  };
  applyZeroRule(m);
  warn(
    'info',
    'legacy_expected_cash',
    g.name,
    budgetRow >= 0 ? rangeRef(budgetRow, firstAcct, budgetRow, cTotal) : null,
    `Legacy sheets have no expected-cash cell; expected cash was set to the budget allocation total ${money(expectedCash)}.`,
  );

  // Controls: journal difference, status, X'fer Amount per account.
  const r = computePlannedMonth(m);
  const jd = valueRight(g, 'Journal difference');
  if (jd) {
    const exp = cellMoney(jd.v);
    if (exp && exp !== 'invalid')
      control(
        `Month ${g.name}`,
        'Journal difference',
        exp,
        r.journalDifference,
        isEffectivelyZero(sub(exp, r.journalDifference)),
      );
  }
  const st = valueRight(g, 'Status');
  if (st && typeof st.v === 'string') {
    const computed = legacyJournalStatus(r.journalDifference);
    control(
      `Month ${g.name}`,
      'Legacy status',
      st.v,
      computed,
      st.v.toLowerCase() === computed.toLowerCase(),
    );
  }
  if (xferRow >= 0) {
    for (const { c, code } of accountCols) {
      const shown = cellMoney(g.v(xferRow, c));
      if (shown === null || shown === 'invalid') continue;
      const line = r.lines.find((l) => l.accountId === code);
      const actual = line?.finalTransfer ?? ZERO;
      if (!isEffectivelyZero(sub(shown, actual))) {
        control(`Month ${g.name}`, `X'fer Amount ${code}`, shown, actual, false);
      }
    }
    control(
      `Month ${g.name}`,
      "X'fer Amount by account",
      'all accounts',
      'recalculated',
      !controlsFailedFor(g.name, r, g, xferRow, accountCols),
    );
  }
  return m;
}

function controlsFailedFor(
  _name: string,
  r: ReturnType<typeof computeMonth>,
  g: Grid,
  xferRow: number,
  cols: { c: number; code: string }[],
) {
  return cols.some(({ c, code }) => {
    const shown = cellMoney(g.v(xferRow, c));
    if (shown === null || shown === 'invalid') return false;
    const actual = r.lines.find((l) => l.accountId === code)?.finalTransfer ?? ZERO;
    return !isEffectivelyZero(sub(shown, actual));
  });
}

/** Blank confirmations on effectively-zero lines become not_required; explicit values are kept. */
function applyZeroRule(m: PlannedMonth, explicit: Set<string> = new Set()) {
  const r = computePlannedMonth(m);
  for (const a of m.allocations) {
    if (explicit.has(a.code)) continue;
    const line = r.lines.find((l) => l.accountId === a.code);
    if (line && !line.required && a.transferState === 'pending') a.transferState = 'not_required';
  }
}

export function computePlannedMonth(m: PlannedMonth) {
  const entries: JournalEntry[] = m.entries.map((e, i) => ({
    id: `e${i}`,
    entryDate: e.entryDate,
    loanId: e.loanId,
    description: e.description,
    notes: e.notes,
    sourceKind: e.sourceKind,
    draftReason: e.draftReason,
    postings: e.postings.map((p, j) => ({
      id: `p${i}.${j}`,
      accountId: p.code,
      amount: p.amount,
      position: j,
    })),
  }));
  return computeMonth({
    expectedCash: m.expectedCash,
    allocations: m.allocations.map((a) => ({
      accountId: a.code,
      budgetAmount: a.budgetAmount,
      transferState: a.transferState,
      notes: a.notes,
    })),
    entries,
    accountOrder: m.allocations.map((a) => a.code),
  });
}

function monthStatusOf(m: PlannedMonth) {
  return computePlannedMonth(m).status;
}
function monthJournalDifference(m: PlannedMonth) {
  return computePlannedMonth(m).journalDifference;
}

// ---------------------------------------------------------------------------
// Account Ledger
// ---------------------------------------------------------------------------

function loanIdText(v: CellValue): string | null {
  if (v === null) return null;
  if (typeof v === 'number') return String(v);
  const t = String(v).trim();
  return t === '' ? null : t;
}

function parseLedger(
  g: Grid,
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  date1904: boolean,
  nextSequence: () => number,
): PlannedDebt[] {
  const h = g.findHeader(['Loan ID', 'Date', 'Debtor account', 'Creditor account', 'Change'])!;
  const find = (label: string) => [...Array(g.cols).keys()].find((c) => g.label(h.row, c) === label) ?? null;
  const c = {
    loan: h.cols.get('loan id')!,
    date: h.cols.get('date')!,
    desc: find('description'),
    debtor: h.cols.get('debtor account')!,
    creditor: h.cols.get('creditor account')!,
    prior: find('prior balance'),
    change: h.cols.get('change')!,
    remaining: find('remaining balance'),
    notes: find('terms / notes') ?? find('notes') ?? find('terms'),
    status: find('status'),
  };
  const lastCol = Math.max(...Object.values(c).filter((x): x is number => x !== null));
  const debts = new Map<string, PlannedDebt & { pendingParties: boolean }>();

  for (let r = h.row + 1; r < g.rows; r++) {
    const loanV = g.v(r, c.loan);
    const dateV = g.v(r, c.date);
    const desc = c.desc !== null ? g.text(r, c.desc) : null;
    const debtorT = g.text(r, c.debtor);
    const creditorT = g.text(r, c.creditor);
    const changeV = g.v(r, c.change);
    const notes = c.notes !== null ? g.text(r, c.notes) : null;
    if ([loanV, dateV, desc, debtorT, creditorT, changeV, notes].every((v) => v === null)) continue;
    const range = rangeRef(r, 0, r, lastCol);
    const loanId = loanIdText(loanV);
    if (!loanId) {
      warn(
        'high',
        'missing_loan_id',
        g.name,
        range,
        `Row ${r + 1} has debt data but no Loan ID, so it cannot be attached to a debt and was not imported: ${[desc, debtorT, creditorT, changeV].filter((x) => x !== null).join(' | ')}`,
      );
      continue;
    }
    let debt = debts.get(loanId);

    let date = cellDate(dateV, date1904);
    if (date === null || date === 'invalid') {
      const fallback = debt?.events[debt.events.length - 1]?.eventDate ?? null;
      if (!fallback) {
        warn(
          'fatal',
          'missing_date',
          g.name,
          ref(r, c.date),
          `Loan ${loanId} row ${r + 1} has no readable date and no earlier event to fall back on.`,
        );
        continue;
      }
      warn(
        'warning',
        'missing_date',
        g.name,
        ref(r, c.date),
        `Loan ${loanId} row ${r + 1} has no readable date; the previous event date ${fallback} was used.`,
      );
      date = fallback;
    }

    let change = cellMoney(changeV);
    if (change === 'invalid') {
      warn(
        'fatal',
        'invalid_change',
        g.name,
        ref(r, c.change),
        `Loan ${loanId} row ${r + 1} change “${String(changeV)}” is not a number.`,
      );
      continue;
    }
    if (change === null) {
      warn(
        'warning',
        'blank_change',
        g.name,
        ref(r, c.change),
        `Loan ${loanId} row ${r + 1} has a blank change; imported as a zero-value event.`,
      );
      change = ZERO;
    }

    const debtorRes = debtorT ? reg.resolve(debtorT, g.name, ref(r, c.debtor)) : null;
    const creditorRes = creditorT ? reg.resolve(creditorT, g.name, ref(r, c.creditor)) : null;

    if (!debt) {
      debt = {
        loanId,
        openedDate: date,
        description: desc,
        debtorCode: debtorRes?.code ?? '',
        creditorCode: creditorRes?.code ?? '',
        terms: notes,
        sheet: g.name,
        range,
        events: [],
        pendingParties: !debtorRes || !creditorRes,
      };
      debts.set(loanId, debt);
      if (!desc)
        warn(
          'info',
          'origin_without_description',
          g.name,
          range,
          `Loan ${loanId} originating row has no description.`,
        );
    } else {
      if (!debt.description && desc) {
        debt.description = desc;
        warn(
          'info',
          'origin_description_later',
          g.name,
          range,
          `Loan ${loanId} origin description taken from later row ${r + 1}.`,
        );
      }
      if (debt.pendingParties) {
        if (!debt.debtorCode && debtorRes) debt.debtorCode = debtorRes.code;
        if (!debt.creditorCode && creditorRes) debt.creditorCode = creditorRes.code;
        warn(
          'warning',
          'origin_parties_later',
          g.name,
          range,
          `Loan ${loanId} origin parties were missing on the first row and were taken from row ${r + 1}.`,
        );
        debt.pendingParties = !debt.debtorCode || !debt.creditorCode;
      }
      const conflicts: string[] = [];
      if (debtorRes && debt.debtorCode && debtorRes.code !== debt.debtorCode)
        conflicts.push(`debtor ${debtorRes.code} (origin ${debt.debtorCode})`);
      if (creditorRes && debt.creditorCode && creditorRes.code !== debt.creditorCode)
        conflicts.push(`creditor ${creditorRes.code} (origin ${debt.creditorCode})`);
      if (conflicts.length) {
        warn(
          'warning',
          'conflicting_party',
          g.name,
          range,
          `Loan ${loanId} row ${r + 1} lists ${conflicts.join(' and ')}. The origin direction was kept; the row's values are preserved on the event.`,
        );
      }
    }

    const prior = c.prior !== null ? cellMoney(g.v(r, c.prior)) : null;
    const remaining = c.remaining !== null ? cellMoney(g.v(r, c.remaining)) : null;
    debt.events.push({
      eventDate: date,
      sequence: nextSequence(),
      changeAmount: change,
      description: desc,
      notes,
      sourceDebtor: debtorT,
      sourceCreditor: creditorT,
      sheet: g.name,
      range,
      control: {
        prior: prior === 'invalid' ? null : prior,
        remaining: remaining === 'invalid' ? null : remaining,
        status: c.status !== null ? g.text(r, c.status) : null,
      },
    });
  }

  const out: PlannedDebt[] = [];
  for (const d of debts.values()) {
    if (!d.debtorCode || !d.creditorCode) {
      warn(
        'fatal',
        'missing_origin_parties',
        g.name,
        d.range,
        `Loan ${d.loanId} has no debtor or creditor on any row.`,
      );
    }
    // Date ordering vs source ordering.
    const outOfOrder = d.events.some((e, i) => i > 0 && e.eventDate < d.events[i - 1].eventDate);
    const position = debtPosition(plannedDebtToDomain(d), plannedEventsToDomain(d));
    const bySeq = new Map(position.events.map((e) => [e.sequence, e]));
    const mismatchedRows: string[] = [];
    for (const e of d.events) {
      const calc = bySeq.get(e.sequence)!;
      const priorBad =
        e.control.prior !== null && !isEffectivelyZero(sub(e.control.prior, calc.priorBalance));
      const remBad =
        e.control.remaining !== null && !isEffectivelyZero(sub(e.control.remaining, calc.remainingBalance));
      if (priorBad || remBad) mismatchedRows.push(e.range.split(':')[0].replace(/^[A-Z]+/, ''));
      if (e.control.status && /cancel/i.test(e.control.status) && calc.status !== 'PAID') {
        warn(
          'info',
          'canceled_status',
          g.name,
          e.range,
          `Loan ${d.loanId} row shows “${e.control.status}”; the app keeps the non-zero balance ${money(calc.remainingBalance)} and flags the note for review.`,
        );
      }
    }
    const lastSource = d.events[d.events.length - 1];
    const workbookFinal = lastSource.control.remaining;
    if (outOfOrder) {
      warn(
        'warning',
        'events_out_of_date_order',
        g.name,
        d.range,
        `Loan ${d.loanId} rows are not in date order in the workbook. The app orders events by date then source row, so intermediate prior/remaining balances differ from the workbook columns (rows ${mismatchedRows.join(', ') || 'none'}).`,
      );
    } else if (mismatchedRows.length) {
      warn(
        'high',
        'balance_mismatch',
        g.name,
        d.range,
        `Loan ${d.loanId}: recalculated prior/remaining balances differ from the workbook on rows ${mismatchedRows.join(', ')}.`,
      );
    }
    if (workbookFinal !== null && !isEffectivelyZero(sub(workbookFinal, position.currentBalance))) {
      warn(
        'high',
        'final_balance_mismatch',
        g.name,
        lastSource.range,
        `Loan ${d.loanId}: workbook final balance ${money(workbookFinal)} differs from recalculated ${money(position.currentBalance)}.`,
      );
    }
    const { pendingParties: _p, ...rest } = d;
    void _p;
    out.push(rest);
  }
  return out;
}

export function plannedDebtToDomain(d: PlannedDebt): Debt {
  return {
    id: d.loanId,
    loanId: d.loanId,
    openedDate: d.openedDate,
    description: d.description,
    originDebtorAccountId: d.debtorCode,
    originCreditorAccountId: d.creditorCode,
    terms: d.terms,
  };
}
export function plannedEventsToDomain(d: PlannedDebt): DebtEvent[] {
  return d.events.map((e: PlannedEvent) => ({
    id: `${d.loanId}#${e.sequence}`,
    debtId: d.loanId,
    eventDate: e.eventDate,
    sequence: e.sequence,
    changeAmount: e.changeAmount,
    description: e.description,
    notes: e.notes,
    journalEntryId: null,
  }));
}

// ---------------------------------------------------------------------------
// Interco Debt Summary (comparison only)
// ---------------------------------------------------------------------------

function compareDebtSummary(
  g: Grid,
  summary: ReturnType<typeof summarizeDebts>,
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  control: (
    group: string,
    name: string,
    expected: string | null,
    actual: string,
    pass: boolean,
    detail?: string,
  ) => void,
) {
  const group = 'Interco Debt Summary';
  const nz = valueRight(g, 'Non-zero debts');
  const tot = valueRight(g, 'Total outstanding');
  const lg = valueRight(g, 'Largest debt');
  if (nz && typeof nz.v === 'number')
    control(
      group,
      'Non-zero debts',
      String(nz.v),
      String(summary.nonZeroCount),
      nz.v === summary.nonZeroCount,
    );
  const tm = tot ? cellMoney(tot.v) : null;
  if (tm && tm !== 'invalid')
    control(
      group,
      'Total outstanding',
      tm,
      summary.totalOutstanding,
      isEffectivelyZero(sub(tm, summary.totalOutstanding)),
    );
  const lm = lg ? cellMoney(lg.v) : null;
  if (lm && lm !== 'invalid')
    control(group, 'Largest debt', lm, summary.largestDebt, isEffectivelyZero(sub(lm, summary.largestDebt)));

  const nh = g.findHeader(['Account', 'Owed to account', 'Owed by account', 'Net position']);
  if (nh) {
    const cA = nh.cols.get('account')!;
    const seen = new Set<string>();
    for (let r = nh.row + 1; r < g.rows; r++) {
      const code = g.text(r, cA);
      if (!code) break;
      const key = reg.peek(code);
      seen.add(key);
      const net = cellMoney(g.v(r, nh.cols.get('net position')!));
      const owedTo = cellMoney(g.v(r, nh.cols.get('owed to account')!));
      const owedBy = cellMoney(g.v(r, nh.cols.get('owed by account')!));
      const app = summary.byAccount.find((a) => a.accountId === key);
      const appNet = app?.net ?? ZERO;
      const pass =
        net !== 'invalid' &&
        isEffectivelyZero(sub(net ?? ZERO, appNet)) &&
        owedTo !== 'invalid' &&
        isEffectivelyZero(sub(owedTo ?? ZERO, app?.owedTo ?? ZERO)) &&
        owedBy !== 'invalid' &&
        isEffectivelyZero(sub(owedBy ?? ZERO, app?.owedBy ?? ZERO));
      control(
        group,
        `Net position ${key}`,
        net === 'invalid' ? String(g.v(r, nh.cols.get('net position')!)) : (net ?? ZERO),
        appNet,
        pass,
        pass
          ? undefined
          : `owed to ${owedTo}/${app?.owedTo ?? ZERO}, owed by ${owedBy}/${app?.owedBy ?? ZERO}`,
      );
    }
    for (const a of summary.byAccount) {
      if (!seen.has(a.accountId))
        control(
          group,
          `Net position ${a.accountId}`,
          null,
          a.net,
          isEffectivelyZero(a.net),
          'account missing from workbook summary',
        );
    }
  }

  // The visible table sits under a "Debt detail" title; the workbook also has a
  // calculation-support block with the same headings, which must be skipped.
  const detailTitle = g.find((l) => l === 'debt detail');
  const dh = detailTitle
    ? g.findHeader(
        ['Loan ID', 'Description', 'Opened', 'Last activity', 'Owed by', 'Owed to', 'Remaining'],
        detailTitle.r,
      )
    : null;
  if (dh) {
    const col = (n: string) => dh.cols.get(n)!;
    const seen = new Set<string>();
    let rowsChecked = 0;
    const problems: string[] = [];
    for (let r = dh.row + 1; r < g.rows; r++) {
      const id = loanIdText(g.v(r, col('loan id')));
      if (!id) break;
      rowsChecked++;
      seen.add(id);
      const app = summary.included.find((p) => p.debt.loanId === id);
      const bal = cellMoney(g.v(r, col('remaining')));
      const by = g.text(r, col('owed by'));
      const to = g.text(r, col('owed to'));
      if (!app) {
        problems.push(`${id} missing in app`);
        continue;
      }
      const okBal = bal !== 'invalid' && bal !== null && isEffectivelyZero(sub(bal, app.displayBalance));
      const okDir =
        by !== null &&
        to !== null &&
        reg.peek(by) === app.owedByAccountId &&
        reg.peek(to) === app.owedToAccountId;
      if (!okBal || !okDir)
        problems.push(
          `${id}: workbook ${by}→${to} ${bal}, app ${app.owedByAccountId}→${app.owedToAccountId} ${app.displayBalance}`,
        );
    }
    for (const p of summary.included)
      if (!seen.has(p.debt.loanId))
        problems.push(`${p.debt.loanId} only in app (${formatUSD(abs(p.currentBalance))})`);
    control(
      group,
      'Debt detail rows (Loan ID, direction, balance)',
      `${rowsChecked} rows`,
      `${summary.included.length} debts`,
      problems.length === 0,
      problems.join('; ') || undefined,
    );
    if (problems.length)
      warn('high', 'debt_detail_mismatch', g.name, null, `Debt detail differences: ${problems.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Application-export metadata tables
// ---------------------------------------------------------------------------

function parseAccountsTable(
  g: Grid,
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
) {
  const h = g.findHeader(['Order', 'Code', 'Display name', 'Description', 'Aliases', 'Active'])!;
  const col = (n: string) => [...Array(g.cols).keys()].find((c) => g.label(h.row, c) === n) ?? null;
  for (let r = h.row + 1; r < g.rows; r++) {
    const code = g.text(r, col('code')!);
    if (!code) continue;
    const a = reg.ensure(code, g.name);
    a.code = code.trim();
    a.displayName = g.text(r, col('display name')!);
    a.description = g.text(r, col('description')!);
    const color = col('color');
    a.color = color !== null ? g.text(r, color) : null;
    a.active = (g.text(r, col('active')!) ?? 'yes').toLowerCase() !== 'no';
    const nr = col('needs review');
    if (nr !== null) a.needsReview = (g.text(r, nr) ?? '').toLowerCase() === 'yes';
    const aliases = g.text(r, col('aliases')!);
    for (const al of (aliases ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (!reg.aliases.has(codeKey(al)))
        reg.aliases.set(codeKey(al), { alias: al, targetCode: a.code, note: 'From exported account roster' });
    }
  }
  if (!reg.accounts.size)
    warn('warning', 'empty_accounts_table', g.name, null, 'Account roster sheet is empty.');
}

function applyDebtsTable(
  g: Grid,
  debts: PlannedDebt[],
  reg: Registry,
  warn: (s: Severity, c: string, sh: string | null, cell: string | null, m: string) => void,
  date1904: boolean,
) {
  const h = g.findHeader(['Loan ID', 'Opened', 'Origin debtor', 'Origin creditor'])!;
  const col = (n: string) => [...Array(g.cols).keys()].find((c) => g.label(h.row, c) === n) ?? null;
  for (let r = h.row + 1; r < g.rows; r++) {
    const id = loanIdText(g.v(r, col('loan id')!));
    if (!id) continue;
    const d = debts.find((x) => x.loanId === id);
    if (!d) {
      warn(
        'warning',
        'debt_without_events',
        g.name,
        ref(r, 0),
        `Debt ${id} is listed in the metadata sheet but has no ledger events.`,
      );
      continue;
    }
    const opened = cellDate(g.v(r, col('opened')!), date1904);
    if (opened && opened !== 'invalid') d.openedDate = opened;
    const desc = col('description');
    if (desc !== null) d.description = g.text(r, desc);
    const terms = col('terms');
    if (terms !== null) d.terms = g.text(r, terms);
    const debtor = g.text(r, col('origin debtor')!);
    const creditor = g.text(r, col('origin creditor')!);
    if (debtor) d.debtorCode = reg.resolve(debtor, g.name, ref(r, col('origin debtor')!)).code;
    if (creditor) d.creditorCode = reg.resolve(creditor, g.name, ref(r, col('origin creditor')!)).code;
  }
}

function parseMonthsTable(g: Grid) {
  const h = g.findHeader(['Month', 'Expected cash', 'Closed', 'Notes'])!;
  const col = (n: string) => [...Array(g.cols).keys()].find((c) => g.label(h.row, c) === n) ?? null;
  const out: {
    month: string;
    notes: string | null;
    closed: boolean;
    closeOverrideNote: string | null;
    expectedCash: Money | null;
  }[] = [];
  const exact = col('expected cash (exact)');
  for (let r = h.row + 1; r < g.rows; r++) {
    const month = g.text(r, col('month')!);
    if (!month) continue;
    const ov = col('close override note');
    out.push({
      month: month.trim(),
      notes: g.text(r, col('notes')!),
      closed: (g.text(r, col('closed')!) ?? '').toLowerCase() === 'yes',
      closeOverrideNote: ov !== null ? g.text(r, ov) : null,
      expectedCash:
        exact !== null ? ((m) => (m && m !== 'invalid' ? m : null))(cellMoney(g.text(r, exact))) : null,
    });
  }
  return out;
}
