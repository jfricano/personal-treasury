import type { Money } from '@/domain/money';
import type { SourceKind, TransferState } from '@/domain/types';

export const RECOGNIZER_VERSION = 'treasury-workbook/1.0.0';

export type Severity = 'info' | 'warning' | 'high' | 'fatal';

export interface PlanWarning {
  severity: Severity;
  code: string;
  sheet: string | null;
  cell: string | null;
  message: string;
}

export type SheetRole =
  | 'overview'
  | 'template'
  | 'ledger'
  | 'legacy_month'
  | 'normalized_month'
  | 'debt_summary'
  | 'accounts_table'
  | 'debts_table'
  | 'months_table'
  | 'export_info'
  | 'ignored';

export interface SheetRecognition {
  name: string;
  role: SheetRole;
  detail: string;
}

export interface PlannedAccount {
  code: string;
  displayName: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  active: boolean;
  needsReview: boolean;
  discoveredIn: string[];
}

export interface PlannedAlias {
  /** Source spelling, e.g. "Splurge". */
  alias: string;
  targetCode: string;
  note: string | null;
}

export interface AliasApplication {
  sheet: string;
  cell: string;
  original: string;
  code: string;
}

export interface PlannedPosting {
  code: string;
  amount: Money;
  originalCode: string | null;
}

export interface PlannedEntry {
  entryDate: string | null;
  loanId: string | null;
  description: string | null;
  notes: string | null;
  sourceKind: SourceKind;
  draftReason: string | null;
  postings: PlannedPosting[];
  sheet: string;
  range: string;
}

export interface PlannedAllocation {
  code: string;
  budgetAmount: Money;
  transferState: TransferState;
  notes: string | null;
  sourceRange: string | null;
}

export interface PlannedMonth {
  month: string;
  expectedCash: Money;
  notes: string | null;
  closed: boolean;
  closeOverrideNote: string | null;
  sheet: string;
  format: 'legacy_matrix' | 'normalized';
  allocations: PlannedAllocation[];
  entries: PlannedEntry[];
}

export interface PlannedEvent {
  eventDate: string;
  sequence: number;
  changeAmount: Money;
  description: string | null;
  notes: string | null;
  sourceDebtor: string | null;
  sourceCreditor: string | null;
  sheet: string;
  range: string;
  /** Workbook-derived values kept only for comparison. */
  control: { prior: Money | null; remaining: Money | null; status: string | null };
}

export interface PlannedDebt {
  loanId: string;
  openedDate: string;
  description: string | null;
  debtorCode: string;
  creditorCode: string;
  terms: string | null;
  sheet: string;
  range: string;
  events: PlannedEvent[];
}

export interface PlannedProfile {
  name: string;
  expectedCash: Money;
  lines: { code: string; amount: Money }[];
  sheet: string;
  range: string | null;
}

export interface ControlCheck {
  group: string;
  name: string;
  /** Value displayed in the workbook (null when the workbook has no such control). */
  expected: string | null;
  /** Value recalculated by the application. */
  actual: string;
  pass: boolean;
  detail?: string;
}

export interface ImportPlan {
  filename: string;
  hash: string;
  recognizerVersion: string;
  analyzedAt: string;
  sheets: SheetRecognition[];
  accounts: PlannedAccount[];
  aliases: PlannedAlias[];
  aliasApplications: AliasApplication[];
  profile: PlannedProfile | null;
  months: PlannedMonth[];
  debts: PlannedDebt[];
  warnings: PlanWarning[];
  controls: ControlCheck[];
  counts: Record<string, number>;
  fatal: boolean;
  duplicateOfRunIds: string[];
}
