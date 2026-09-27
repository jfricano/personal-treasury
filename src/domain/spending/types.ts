export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'brokerage'
  | 'retirement'
  | 'loan'
  | 'other_asset'
  | 'other_liability';
export type Provider = 'file' | 'plaid' | 'simplefin';
export interface Connection {
  id: string;
  provider: Provider;
  displayName: string;
  status: 'ready' | 'reconnect' | 'error' | 'removed';
  credentialRef: string | null;
  providerRef: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consentExpiresAt: string | null;
}
export interface InstitutionAccount {
  id: string;
  connectionId: string;
  providerRef: string;
  displayName: string;
  mask: string;
  kind: AccountKind;
  inReview: boolean;
  inSnapshot: boolean;
  confirmed: boolean;
  treasuryAccountId: string | null;
  shared: boolean;
  active: boolean;
  csvProfile: CsvProfile | null;
}
export interface CsvProfile {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  outflowPositive: boolean;
}
export interface Period {
  start: string;
  end: string;
}
export interface Source {
  kind: Provider | 'manual';
  name: string;
  hash?: string;
  row?: string;
}
export type Disposition = (
  | { kind: 'budget'; parts: { lineKey: string; amount: string }[] }
  | { kind: 'income'; incomeKind: 'take_home' | 'other' }
  | { kind: 'transfer'; pairedId?: string; counterparty?: string }
  | { kind: 'unbudgeted' }
  | {
      kind: 'excluded';
      reason: 'reimbursable' | 'not_household' | 'duplicate_at_source' | 'adjustment' | 'other';
      note?: string;
    }
) & { state: 'suggested' | 'accepted'; ruleId?: string };
export interface Transaction {
  id: string;
  institutionAccountId: string;
  source: Source;
  postedDate: string;
  authorizedDate?: string;
  amount: string;
  sourceAmount: string;
  description: string;
  merchantName?: string;
  pending: boolean;
  removedAtSource: boolean;
  removalConfirmed?: boolean;
  duplicateConfirmed?: boolean;
  changed?: boolean;
  disposition?: Disposition;
}
export interface Evidence {
  periods: Period[];
  source: Provider | 'manual';
  gatheredAt: string;
  freshness?: string;
  historyConfirmed?: boolean;
  historyStart?: string;
  linkedAt?: string;
  error?: string;
  reconnect?: boolean;
  waiver?: { reason: string; note: string };
}
export interface Balance {
  value: string | null;
  asOf: string;
  unavailable: boolean;
  periods: Period[];
  details?: {
    statementBalance?: string;
    minimumPayment?: string;
    apr?: string;
    dueDate?: string;
    originalPrincipal?: string;
    source: string;
  };
}
export interface Review {
  ref: string;
  month: string;
  budgetVersionId: string;
  createdAt: string;
  updatedAt: string;
  timeZone: string;
  settleDays: number;
  pairingDays: number;
  transactions: Transaction[];
  evidence: Record<string, Evidence>;
  balances: Record<string, Balance>;
  importedHashes: string[];
  note: string;
}
export interface Rule {
  id: string;
  position: number;
  enabled: boolean;
  createdAt: string;
  pattern: string;
  match: 'contains' | 'starts_with' | 'equals';
  accountId?: string;
  merchant?: string;
  direction: 'any' | 'inflow' | 'outflow';
  min?: string;
  max?: string;
  action:
    | { kind: 'budget'; lineKey: string }
    | { kind: 'income'; incomeKind: 'take_home' | 'other' }
    | { kind: 'transfer'; counterparty: string }
    | { kind: 'unbudgeted' }
    | {
        kind: 'excluded';
        reason: 'reimbursable' | 'not_household' | 'duplicate_at_source' | 'adjustment' | 'other';
        note?: string;
      };
}
export interface PlannedLine {
  lineKey: string;
  label: string;
  category: string;
  fundingAccountId: string | null;
  fundingAccount: string;
  role: 'spending' | 'set_aside';
  planned: string;
}
export interface ReportLine extends PlannedLine {
  actual: string;
  count: number;
  note: string;
}
export interface ReportSource {
  accountId: string;
  label: string;
  kind: AccountKind;
  source: string;
  status: string;
  waiver: string;
  historyConfirmed: boolean;
  count: number;
  inflows: string;
  outflows: string;
  tailCount: number;
  tailSum: string;
  periods: Period[];
}
export interface Snapshot {
  accountId: string;
  label: string;
  kind: AccountKind;
  value: string | null;
  asOf: string;
  estimate: boolean;
  unavailable: boolean;
  details?: Balance['details'];
}
export interface Report {
  month: string;
  clearedAt: string;
  budgetVersionId: string | null;
  budgetLabel: string;
  timeZone: string;
  settleDays: number;
  pairingDays: number;
  appVersion: string;
  count: number;
  inflows: string;
  outflows: string;
  note: string;
  lines: ReportLine[];
  unbudgeted: { actual: string; count: number };
  income: { planned: string; takeHome: string; other: string; count: number };
  flows: { kind: string; total: string; count: number }[];
  sources: ReportSource[];
  balances: Snapshot[];
}
export interface ReviewBudget {
  id: string;
  label: string;
  takeHome: string;
  lines: PlannedLine[];
}
