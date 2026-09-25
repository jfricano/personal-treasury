import {
  type Money,
  ZERO,
  abs,
  add,
  formatUSD,
  isEffectivelyZero,
  isMoney,
  isNegative,
  isStrictlyPositive,
  neg,
  normalize,
  sub,
  sum,
  dec,
} from './money';
import type { AllocationLine, JournalEntry, MonthStatus, Posting, TransferState } from './types';

// ---------------------------------------------------------------------------
// Ordinary two-account transfers
// ---------------------------------------------------------------------------

export interface TransferInput {
  fromAccountId: string | null | undefined;
  toAccountId: string | null | undefined;
  amount: Money | null | undefined;
}

export type TransferError =
  'missing_from' | 'missing_to' | 'same_account' | 'missing_amount' | 'amount_not_positive';

export const TRANSFER_ERROR_TEXT: Record<TransferError, string> = {
  missing_from: 'From account is required',
  missing_to: 'To account is required',
  same_account: 'From and To accounts must differ',
  missing_amount: 'Amount is required',
  amount_not_positive: 'Amount must be greater than zero',
};

export function validateTransfer(t: TransferInput): TransferError[] {
  const errors: TransferError[] = [];
  if (!t.fromAccountId) errors.push('missing_from');
  if (!t.toAccountId) errors.push('missing_to');
  if (t.fromAccountId && t.toAccountId && t.fromAccountId === t.toAccountId) errors.push('same_account');
  if (t.amount == null || t.amount === '' || !isMoney(t.amount)) errors.push('missing_amount');
  else if (!isStrictlyPositive(t.amount)) errors.push('amount_not_positive');
  return errors;
}

/** From decreases (negative posting); To increases (positive posting). */
export function transferPostings(
  t: { fromAccountId: string; toAccountId: string; amount: Money },
  newId: () => string,
): Posting[] {
  const errors = validateTransfer(t);
  if (errors.length)
    throw new Error(`Invalid transfer: ${errors.map((e) => TRANSFER_ERROR_TEXT[e]).join('; ')}`);
  const amount = normalize(t.amount);
  return [
    { id: newId(), accountId: t.fromAccountId, amount: neg(amount), position: 0 },
    { id: newId(), accountId: t.toAccountId, amount, position: 1 },
  ];
}

/** If an entry is an ordinary transfer (one negative, one equal positive), return its parts. */
export function asSimpleTransfer(
  entry: Pick<JournalEntry, 'postings'>,
): { fromAccountId: string; toAccountId: string; amount: Money } | null {
  if (entry.postings.length !== 2) return null;
  const [a, b] = entry.postings;
  const from = dec(a.amount).isNegative() ? a : b;
  const to = from === a ? b : a;
  if (!dec(from.amount).isNegative() || !isStrictlyPositive(to.amount)) return null;
  if (!dec(from.amount).plus(dec(to.amount)).isZero()) return null;
  if (from.accountId === to.accountId) return null;
  return { fromAccountId: from.accountId, toAccountId: to.accountId, amount: to.amount };
}

// ---------------------------------------------------------------------------
// Journal-entry validation
// ---------------------------------------------------------------------------

export interface EntryResult {
  entryId: string;
  difference: Money;
  balanced: boolean;
  valid: boolean;
  reasons: string[];
}

export function evaluateEntry(entry: JournalEntry): EntryResult {
  const difference = sum(entry.postings.map((p) => p.amount));
  const balanced = isEffectivelyZero(difference);
  const reasons: string[] = [];
  if (entry.draftReason) reasons.push(entry.draftReason);
  if (entry.postings.length < 2) reasons.push('Needs at least two postings');
  if (entry.postings.some((p) => !p.accountId)) reasons.push('Posting is missing an account');
  if (entry.postings.length === 2 && entry.postings[0].accountId === entry.postings[1].accountId) {
    reasons.push('Same account');
  }
  if (!balanced) reasons.push(`Out of balance by ${formatUSD(difference)}`);
  return { entryId: entry.id, difference, balanced, valid: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Monthly reconciliation
// ---------------------------------------------------------------------------

export interface AccountLine {
  accountId: string;
  budgetAmount: Money;
  transfersIn: Money;
  transfersOut: Money;
  netPostings: Money;
  finalTransfer: Money;
  /** True when |final transfer| >= 0.01 and a completion mark is needed. */
  required: boolean;
  /** Stored user state. */
  storedState: TransferState;
  /** State after applying the zero rule: effective-zero lines are always not_required. */
  effectiveState: TransferState;
  negative: boolean;
  notes: string | null;
  /** True when the account has postings but no stored allocation line. */
  implicit: boolean;
}

export type IssueCode =
  | 'allocation_difference'
  | 'journal_difference'
  | 'final_transfer_difference'
  | 'invalid_entry'
  | 'negative_transfer'
  | 'unconfirmed_transfer';

export interface MonthIssue {
  code: IssueCode;
  /** Whether this issue forces Review (unconfirmed transfers do not). */
  blocking: boolean;
  message: string;
  amount?: Money;
  accountId?: string;
  entryId?: string;
}

export interface MonthInput {
  expectedCash: Money;
  allocations: AllocationLine[];
  entries: JournalEntry[];
  /** Account display order; accounts not listed sort after, by code. */
  accountOrder?: string[];
  accountCode?: (accountId: string) => string;
}

export interface MonthResult {
  lines: AccountLine[];
  totals: { budget: Money; transfersIn: Money; transfersOut: Money; finalTransfer: Money };
  allocationDifference: Money;
  journalDifference: Money;
  finalTransferDifference: Money;
  entryResults: EntryResult[];
  invalidEntryCount: number;
  negativeTransferCount: number;
  requiredCount: number;
  doneCount: number;
  status: MonthStatus;
  issues: MonthIssue[];
  checks: {
    allocation: boolean;
    journal: boolean;
    finalTransfer: boolean;
    entries: boolean;
    negatives: boolean;
  };
}

export function computeMonth(input: MonthInput): MonthResult {
  const code = input.accountCode ?? ((id: string) => id);
  const allocationByAccount = new Map(input.allocations.map((a) => [a.accountId, a]));

  // Postings per account.
  const inByAccount = new Map<string, Money[]>();
  const outByAccount = new Map<string, Money[]>();
  const netByAccount = new Map<string, Money[]>();
  for (const entry of input.entries) {
    for (const p of entry.postings) {
      if (!p.accountId) continue;
      const bucket = dec(p.amount).isNegative() ? outByAccount : inByAccount;
      bucket.set(p.accountId, [...(bucket.get(p.accountId) ?? []), p.amount]);
      netByAccount.set(p.accountId, [...(netByAccount.get(p.accountId) ?? []), p.amount]);
    }
  }

  const accountIds = new Set<string>([...allocationByAccount.keys(), ...netByAccount.keys()]);
  const order = input.accountOrder ?? [];
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const sortedIds = [...accountIds].sort((a, b) => {
    const ia = orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ib = orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ia !== ib ? ia - ib : code(a).localeCompare(code(b));
  });

  const lines: AccountLine[] = sortedIds.map((accountId) => {
    const alloc = allocationByAccount.get(accountId);
    const budgetAmount = alloc ? normalize(alloc.budgetAmount) : ZERO;
    const transfersIn = sum(inByAccount.get(accountId) ?? []);
    const transfersOut = abs(sum(outByAccount.get(accountId) ?? []));
    const netPostings = sum(netByAccount.get(accountId) ?? []);
    const finalTransfer = add(budgetAmount, netPostings);
    const required = !isEffectivelyZero(finalTransfer);
    const storedState: TransferState = alloc?.transferState ?? 'pending';
    const effectiveState: TransferState = !required
      ? 'not_required'
      : storedState === 'done'
        ? 'done'
        : 'pending';
    return {
      accountId,
      budgetAmount,
      transfersIn,
      transfersOut,
      netPostings,
      finalTransfer,
      required,
      storedState,
      effectiveState,
      negative: isNegative(finalTransfer),
      notes: alloc?.notes ?? null,
      implicit: !alloc,
    };
  });

  const totals = {
    budget: sum(lines.map((l) => l.budgetAmount)),
    transfersIn: sum(lines.map((l) => l.transfersIn)),
    transfersOut: sum(lines.map((l) => l.transfersOut)),
    finalTransfer: sum(lines.map((l) => l.finalTransfer)),
  };
  const allocationDifference = sub(totals.budget, input.expectedCash);
  const journalDifference = sum(input.entries.flatMap((e) => e.postings.map((p) => p.amount)));
  const finalTransferDifference = sub(totals.finalTransfer, input.expectedCash);
  const entryResults = input.entries.map(evaluateEntry);
  const invalid = entryResults.filter((r) => !r.valid);
  const negatives = lines.filter((l) => l.negative);
  const required = lines.filter((l) => l.required);
  const done = required.filter((l) => l.effectiveState === 'done');

  const checks = {
    allocation: isEffectivelyZero(allocationDifference),
    journal: isEffectivelyZero(journalDifference),
    finalTransfer: isEffectivelyZero(finalTransferDifference),
    entries: invalid.length === 0,
    negatives: negatives.length === 0,
  };

  const issues: MonthIssue[] = [];
  if (!checks.allocation) {
    const over = dec(allocationDifference).isPositive();
    issues.push({
      code: 'allocation_difference',
      blocking: true,
      amount: allocationDifference,
      message: `Allocations ${over ? 'exceed' : 'fall short of'} expected cash by ${formatUSD(abs(allocationDifference))}`,
    });
  }
  if (!checks.journal) {
    issues.push({
      code: 'journal_difference',
      blocking: true,
      amount: journalDifference,
      message: `Transfer journal is out of balance by ${formatUSD(journalDifference)}`,
    });
  }
  if (!checks.finalTransfer) {
    issues.push({
      code: 'final_transfer_difference',
      blocking: true,
      amount: finalTransferDifference,
      message: `Final transfers differ from expected cash by ${formatUSD(finalTransferDifference)}`,
    });
  }
  const entryById = new Map(input.entries.map((e) => [e.id, e]));
  for (const r of invalid) {
    const e = entryById.get(r.entryId)!;
    const label = [
      e.entryDate ? `on ${e.entryDate}` : null,
      e.loanId ? `(Loan ${e.loanId})` : null,
      e.description ? `“${e.description}”` : null,
    ]
      .filter(Boolean)
      .join(' ');
    issues.push({
      code: 'invalid_entry',
      blocking: true,
      entryId: r.entryId,
      amount: r.difference,
      message: `Journal entry ${label || 'without description'}: ${r.reasons.join('; ')}`,
    });
  }
  for (const l of negatives) {
    issues.push({
      code: 'negative_transfer',
      blocking: true,
      accountId: l.accountId,
      amount: l.finalTransfer,
      message: `Final transfer for ${code(l.accountId)} is negative (${formatUSD(l.finalTransfer)})`,
    });
  }
  for (const l of required) {
    if (l.effectiveState !== 'done') {
      issues.push({
        code: 'unconfirmed_transfer',
        blocking: false,
        accountId: l.accountId,
        amount: l.finalTransfer,
        message: `${code(l.accountId)} transfer of ${formatUSD(l.finalTransfer)} has not been confirmed`,
      });
    }
  }

  const reviewNeeded = Object.values(checks).some((ok) => !ok);
  const status: MonthStatus = reviewNeeded
    ? 'REVIEW'
    : done.length === required.length
      ? 'COMPLETE'
      : 'READY_TO_TRANSFER';

  return {
    lines,
    totals,
    allocationDifference,
    journalDifference,
    finalTransferDifference,
    entryResults,
    invalidEntryCount: invalid.length,
    negativeTransferCount: negatives.length,
    requiredCount: required.length,
    doneCount: done.length,
    status,
    issues,
    checks,
  };
}

/** Legacy matrix sheets only checked the journal difference ("Balanced"/"Review"). */
export function legacyJournalStatus(journalDifference: Money): 'Balanced' | 'Review' {
  return isEffectivelyZero(journalDifference) ? 'Balanced' : 'Review';
}

/** Next calendar month for a YYYY-MM string. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map((s) => Number.parseInt(s, 10));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map((s) => Number.parseInt(s, 10));
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[m - 1]} ${y}`;
}
