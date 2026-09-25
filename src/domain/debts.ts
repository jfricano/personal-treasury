import { type Money, ZERO, abs, add, cmp, dec, isEffectivelyZero, max, neg, sum } from './money';
import type { Debt, DebtEvent, DebtStatus } from './types';

export interface RolledEvent extends DebtEvent {
  priorBalance: Money;
  remainingBalance: Money;
  status: DebtStatus;
  reviewNote: boolean;
}

export function debtStatus(balance: Money): DebtStatus {
  if (isEffectivelyZero(balance)) return 'PAID';
  return dec(balance).isNegative() ? 'CREDIT' : 'OPEN';
}

export const hasCancelNote = (text: string | null | undefined): boolean => !!text && /cancel/i.test(text);

/** Events ordered by event date, then stable source/entry sequence. */
export function orderEvents<T extends Pick<DebtEvent, 'eventDate' | 'sequence'>>(events: T[]): T[] {
  return [...events].sort((a, b) =>
    a.eventDate !== b.eventDate ? (a.eventDate < b.eventDate ? -1 : 1) : a.sequence - b.sequence,
  );
}

/** prior[n] = sum(change[1..n-1]); remaining[n] = prior[n] + change[n]. */
export function rollForward(events: DebtEvent[]): RolledEvent[] {
  let running: Money = ZERO;
  return orderEvents(events).map((e) => {
    const priorBalance = running;
    const remainingBalance = add(priorBalance, e.changeAmount);
    running = remainingBalance;
    return {
      ...e,
      priorBalance,
      remainingBalance,
      status: debtStatus(remainingBalance),
      reviewNote: hasCancelNote(e.notes),
    };
  });
}

export interface DebtPosition {
  debt: Debt;
  events: RolledEvent[];
  currentBalance: Money;
  status: DebtStatus;
  /** Current direction after applying the negative-balance reversal. */
  owedByAccountId: string;
  owedToAccountId: string;
  displayBalance: Money;
  lastActivity: string | null;
  /** Latest event note if present, otherwise the originating terms (workbook rule). */
  displayNotes: string | null;
  reviewNote: boolean;
  reversed: boolean;
}

export function debtPosition(debt: Debt, events: DebtEvent[]): DebtPosition {
  const rolled = rollForward(events);
  const last = rolled[rolled.length - 1];
  const currentBalance = last ? last.remainingBalance : ZERO;
  const reversed = dec(currentBalance).isNegative();
  const latestNote = last?.notes?.trim() ? last.notes : null;
  const displayNotes = latestNote ?? debt.terms ?? null;
  return {
    debt,
    events: rolled,
    currentBalance,
    status: debtStatus(currentBalance),
    owedByAccountId: reversed ? debt.originCreditorAccountId : debt.originDebtorAccountId,
    owedToAccountId: reversed ? debt.originDebtorAccountId : debt.originCreditorAccountId,
    displayBalance: abs(currentBalance),
    lastActivity: last ? last.eventDate : null,
    displayNotes,
    reviewNote: hasCancelNote(displayNotes) || rolled.some((e) => e.reviewNote) || hasCancelNote(debt.terms),
    reversed,
  };
}

export interface AccountDebtPosition {
  accountId: string;
  owedTo: Money;
  owedBy: Money;
  net: Money;
  owedToLoanIds: string[];
  owedByLoanIds: string[];
}

export interface DebtSummary {
  included: DebtPosition[];
  nonZeroCount: number;
  totalOutstanding: Money;
  largestDebt: Money;
  largestLoanIds: string[];
  byAccount: AccountDebtPosition[];
  netSum: Money;
}

/** Only the latest balance per Loan ID with |balance| >= 0.01 is included. */
export function summarizeDebts(positions: DebtPosition[], accountCode?: (id: string) => string): DebtSummary {
  const included = positions.filter((p) => !isEffectivelyZero(p.currentBalance));
  const totalOutstanding = sum(included.map((p) => p.displayBalance));
  const largestDebt = included.reduce<Money>((m, p) => max(m, p.displayBalance), ZERO);
  const largestLoanIds = included
    .filter((p) => cmp(p.displayBalance, largestDebt) === 0)
    .map((p) => p.debt.loanId);

  const acc = new Map<string, { to: Money[]; by: Money[]; toIds: string[]; byIds: string[] }>();
  const bucket = (id: string) => {
    if (!acc.has(id)) acc.set(id, { to: [], by: [], toIds: [], byIds: [] });
    return acc.get(id)!;
  };
  for (const p of included) {
    const to = bucket(p.owedToAccountId);
    to.to.push(p.displayBalance);
    to.toIds.push(p.debt.loanId);
    const by = bucket(p.owedByAccountId);
    by.by.push(p.displayBalance);
    by.byIds.push(p.debt.loanId);
  }
  const code = accountCode ?? ((id: string) => id);
  const byAccount = [...acc.entries()]
    .map(([accountId, v]) => {
      const owedTo = sum(v.to);
      const owedBy = sum(v.by);
      return {
        accountId,
        owedTo,
        owedBy,
        net: add(owedTo, neg(owedBy)),
        owedToLoanIds: v.toIds,
        owedByLoanIds: v.byIds,
      };
    })
    .sort((a, b) => code(a.accountId).localeCompare(code(b.accountId)));

  return {
    included,
    nonZeroCount: included.length,
    totalOutstanding,
    largestDebt,
    largestLoanIds,
    byAccount,
    netSum: sum(byAccount.map((a) => a.net)),
  };
}

/**
 * Convert a user-facing positive payment into the signed change stored on the
 * event. A payment always moves the balance toward zero in the *current*
 * direction, so it is negative while the balance is positive and positive once
 * the debt has reversed into credit.
 */
export function paymentToChange(currentBalance: Money, payment: Money): Money {
  return dec(currentBalance).isNegative() ? abs(payment) : neg(abs(payment));
}

/** Preview of a change before it is saved. */
export function previewChange(debt: Debt, events: DebtEvent[], change: Money, eventDate: string) {
  const probe: DebtEvent = {
    id: '__preview__',
    debtId: debt.id,
    eventDate,
    sequence: Number.MAX_SAFE_INTEGER,
    changeAmount: change,
    description: null,
    notes: null,
    journalEntryId: null,
  };
  const before = debtPosition(debt, events);
  const after = debtPosition(debt, [...events, probe]);
  return { before, after, directionChanges: before.reversed !== after.reversed && after.status !== 'PAID' };
}

/**
 * Suggest the debt change implied by a monthly transfer that references a Loan ID.
 * Moving cash from the origin debtor to the origin creditor reduces the balance;
 * the opposite direction increases it. Other account pairs have no suggestion.
 */
export function suggestChangeForTransfer(
  debt: Debt,
  transfer: { fromAccountId: string; toAccountId: string; amount: Money },
): Money | null {
  if (
    transfer.fromAccountId === debt.originDebtorAccountId &&
    transfer.toAccountId === debt.originCreditorAccountId
  ) {
    return neg(abs(transfer.amount));
  }
  if (
    transfer.fromAccountId === debt.originCreditorAccountId &&
    transfer.toAccountId === debt.originDebtorAccountId
  ) {
    return abs(transfer.amount);
  }
  return null;
}
