import type { Money } from './money';

export type TransferState = 'pending' | 'done' | 'not_required';
export type SourceKind = 'user' | 'normalized_workbook' | 'legacy_matrix';

export interface Provenance {
  sourceWorkbook?: string | null;
  sourceSheet?: string | null;
  sourceRange?: string | null;
  importRunId?: string | null;
}

export interface Account {
  id: string;
  code: string;
  displayName: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  active: boolean;
  /** Imported codes that could not be resolved (e.g. `???`) stay flagged until reviewed. */
  needsReview: boolean;
}

export interface AccountAlias {
  alias: string;
  accountId: string;
  originalText: string;
}

export type AllocationOrigin = 'budget' | 'manual_override' | 'import' | 'template';
export type ExpectedCashOrigin = 'budget' | 'manual' | 'import' | 'template';

export interface AllocationLine {
  accountId: string;
  budgetAmount: Money;
  transferState: TransferState;
  notes: string | null;
  /** What the budget plan proposed for this account (null when not budget-driven). */
  plannedAmount?: Money | null;
  origin?: AllocationOrigin | null;
}

export interface Posting {
  id: string;
  accountId: string;
  amount: Money;
  position: number;
  /** Source spelling when an alias was applied, e.g. "Splurge". */
  originalCode?: string | null;
}

export interface JournalEntry extends Provenance {
  id: string;
  entryDate: string | null;
  loanId: string | null;
  description: string | null;
  notes: string | null;
  sourceKind: SourceKind;
  /** Set for imported rows kept as flagged drafts (e.g. "Incomplete"). Always invalid. */
  draftReason: string | null;
  postings: Posting[];
}

export interface MonthlyCycle extends Provenance {
  id: string;
  month: string; // YYYY-MM
  expectedCash: Money;
  notes: string | null;
  closedAt: string | null;
  /** Budget version the month was created or refreshed from; null for archival/manual months. */
  budgetVersionId?: string | null;
  expectedCashOrigin?: ExpectedCashOrigin | null;
}

export interface Debt extends Provenance {
  id: string;
  loanId: string;
  openedDate: string;
  description: string | null;
  originDebtorAccountId: string;
  originCreditorAccountId: string;
  terms: string | null;
}

export interface DebtEvent extends Provenance {
  id: string;
  debtId: string;
  eventDate: string;
  sequence: number;
  changeAmount: Money;
  description: string | null;
  notes: string | null;
  journalEntryId: string | null;
  /** Source party values as written on this row, retained when they differ from origin. */
  sourceDebtor?: string | null;
  sourceCreditor?: string | null;
}

export type MonthStatus = 'REVIEW' | 'READY_TO_TRANSFER' | 'COMPLETE';
export type DebtStatus = 'OPEN' | 'PAID' | 'CREDIT';

export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  REVIEW: 'Review',
  READY_TO_TRANSFER: 'Ready to transfer',
  COMPLETE: 'Complete',
};

export const DEBT_STATUS_LABEL: Record<DebtStatus, string> = {
  OPEN: 'Open',
  PAID: 'Paid',
  CREDIT: 'Credit',
};
