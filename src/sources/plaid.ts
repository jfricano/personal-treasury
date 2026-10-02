import { parse } from 'lossless-json';
import { z } from '@/security/schema';
import {
  exactAmount,
  liabilityKinds,
  safeText,
  calendarDate,
  type Transaction,
  type InstitutionAccount,
  type Balance,
} from '@/domain/spending';
import { neg } from '@/domain/money';
const Amount = z.string().transform(exactAmount);
const TransactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  date: z.string().transform(calendarDate),
  authorized_date: z.string().nullable().optional(),
  amount: Amount,
  name: z.string().transform(safeText),
  merchant_name: z.string().nullable().optional(),
  pending: z.boolean(),
  iso_currency_code: z.string().nullable().optional(),
});
const AccountSchema = z.object({
  account_id: z.string(),
  name: z.string().transform(safeText),
  mask: z.string().nullable(),
  type: z.string(),
  subtype: z.string().nullable(),
  balances: z.object({ current: Amount.nullable(), iso_currency_code: z.string().nullable().optional() }),
});
export function parsePlaid(text: string) {
  return parse(text, null, (number: string) => number);
}
export function plaidTransactions(text: string, accounts: InstitutionAccount[]): Transaction[] {
  const result = z.object({ transactions: z.array(TransactionSchema) }).parse(parsePlaid(text));
  return result.transactions.map((tx) => {
    const account = accounts.find((a) => a.providerRef === tx.account_id);
    if (!account) throw new Error('Confirm the new provider account before gathering its transactions.');
    if (tx.iso_currency_code && tx.iso_currency_code !== 'USD')
      throw new Error('Only USD transactions are supported.');
    return {
      id: `plaid:${account.id}:${tx.transaction_id}`,
      institutionAccountId: account.id,
      source: { kind: 'plaid', name: 'plaid' },
      postedDate: tx.date,
      authorizedDate: tx.authorized_date ?? undefined,
      amount: neg(tx.amount),
      sourceAmount: tx.amount,
      description: tx.name,
      merchantName: tx.merchant_name ? safeText(tx.merchant_name) : undefined,
      pending: tx.pending,
      removedAtSource: false,
    };
  });
}
export function plaidAccounts(
  text: string,
  connectionId: string,
  existing: InstitutionAccount[] = [],
  asOf = new Date().toISOString().slice(0, 10),
) {
  const result = z.object({ accounts: z.array(AccountSchema) }).parse(parsePlaid(text));
  return result.accounts.map((a) => {
    if (a.balances.iso_currency_code && a.balances.iso_currency_code !== 'USD')
      throw new Error('Only USD balances are supported.');
    const kind: InstitutionAccount['kind'] =
      a.type === 'credit'
        ? 'credit_card'
        : a.type === 'loan'
          ? a.subtype === 'student'
            ? 'student_loan'
            : a.subtype === 'auto'
              ? 'auto_loan'
              : a.subtype === 'mortgage'
                ? 'mortgage'
                : 'loan'
          : a.type === 'investment'
            ? a.subtype?.includes('ira')
              ? 'retirement'
              : 'brokerage'
            : a.subtype === 'savings'
              ? 'savings'
              : 'checking';
    const prior = existing.find((x) => x.providerRef === a.account_id);
    const account: InstitutionAccount = prior ?? {
      id: crypto.randomUUID(),
      connectionId,
      providerRef: a.account_id,
      displayName: a.name,
      mask: (a.mask ?? '').slice(-4),
      kind,
      inReview: ['checking', 'savings', 'credit_card'].includes(kind),
      inSnapshot: true,
      confirmed: false,
      treasuryAccountId: null,
      shared: true,
      active: true,
      csvProfile: null,
    };
    const balance: Balance = {
      value:
        a.balances.current === null
          ? null
          : liabilityKinds.includes(kind)
            ? neg(a.balances.current)
            : a.balances.current,
      asOf,
      source: 'plaid',
      capturedAt: new Date().toISOString(),
      unavailable: false,
      periods: [],
    };
    return { account, balance };
  });
}
export interface PendingLink {
  linkToken: string;
  hostedUrl: string;
  connectionId: string;
  reconnect: boolean;
  institutionId: string;
  displayName: string;
  reservation: boolean;
  counted: boolean;
  publicToken?: string;
}
export interface PlaidCredential {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'production';
  items: {
    connectionId: string;
    accessToken: string;
    itemId: string;
    institutionId: string;
    displayName?: string;
  }[];
  productionItemsUsed: number;
  pendingLink?: PendingLink;
}
export interface ProviderVault {
  plaid?: PlaidCredential;
}
export async function plaidRequest(
  credential: PlaidCredential,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('plaid_request', {
    environment: credential.environment,
    endpoint,
    body: { ...body, client_id: credential.clientId, secret: credential.secret },
  });
}
export function guardTrial(credential: PlaidCredential, institutionId: string) {
  if (credential.items.some((i) => i.institutionId === institutionId))
    throw new Error('This institution is already connected. Use Reconnect.');
  if (
    credential.environment === 'production' &&
    credential.productionItemsUsed + (credential.pendingLink?.reservation ? 1 : 0) >= 10
  )
    throw new Error('TRIAL_CONNECTION_LIMIT: all ten lifetime Items have been used. Use statement files.');
}

/** Consume conservatively before opening, including retries with uncertain prior outcomes. */
export function countLinkAttempt(c: PlaidCredential): PlaidCredential {
  const pending = c.pendingLink;
  if (!pending) throw new Error('No pending Hosted Link');
  if (pending.publicToken)
    throw new Error('Check the completed connection result instead of reopening Link.');
  if (pending.reconnect || c.environment === 'sandbox') return c;
  if (c.productionItemsUsed >= 10)
    throw new Error('TRIAL_CONNECTION_LIMIT: all ten lifetime Items have been used.');
  return {
    ...c,
    productionItemsUsed: c.productionItemsUsed + 1,
    pendingLink: { ...pending, reservation: false, counted: true },
  };
}
export function abandonPendingLink(c: PlaidCredential): PlaidCredential {
  return {
    ...c,
    productionItemsUsed:
      c.productionItemsUsed +
      (c.environment === 'production' && c.pendingLink?.reservation && !c.pendingLink.counted ? 1 : 0),
    pendingLink: undefined,
  };
}

export function hostedLinkResult(text: string, expectedInstitutionId: string) {
  const institution = z.object({ institution_id: z.string().min(1) });
  const result = z.object({ public_token: z.string().min(1), institution });
  const response = z
    .object({
      link_sessions: z.array(
        z.object({
          finished_at: z.string().nullable().optional(),
          results: z.object({ item_add_results: z.array(result).optional() }).optional(),
          on_success: z
            .object({ public_token: z.string(), metadata: z.object({ institution }) })
            .nullable()
            .optional(),
        }),
      ),
    })
    .parse(parsePlaid(text));
  const added = response.link_sessions.flatMap(
    (s) =>
      s.results?.item_add_results ??
      (s.on_success
        ? [{ public_token: s.on_success.public_token, institution: s.on_success.metadata.institution }]
        : []),
  );
  if (added.length !== 1) throw new Error('Hosted Link must return exactly one completed connection.');
  if (added[0].institution.institution_id !== expectedInstitutionId)
    throw new Error(
      'Hosted Link selected a different institution. Do not exchange its token; resume or abandon this connection.',
    );
  return added[0].public_token;
}
export function missingPlaidRows(
  prior: Transaction[],
  fresh: Transaction[],
  accountIds: Set<string>,
  window: { start: string; end: string },
) {
  const present = new Set(fresh.map((t) => t.id));
  return prior
    .filter(
      (t) =>
        t.source.kind === 'plaid' &&
        accountIds.has(t.institutionAccountId) &&
        t.postedDate >= window.start &&
        t.postedDate <= window.end &&
        !present.has(t.id),
    )
    .map((t) => ({ ...t, removedAtSource: true }));
}
export function plaidLiabilities(text: string, accounts: InstitutionAccount[]) {
  const optionalAmount = Amount.nullable().optional(),
    date = z.string().transform(calendarDate).nullable().optional();
  const common = {
    account_id: z.string(),
    last_statement_balance: optionalAmount,
    minimum_payment_amount: optionalAmount,
    next_payment_due_date: date,
    origination_principal_amount: optionalAmount,
  };
  const result = z
    .object({
      liabilities: z.object({
        credit: z
          .array(
            z.object({
              ...common,
              aprs: z.array(z.object({ apr_type: z.string(), apr_percentage: Amount })).optional(),
            }),
          )
          .nullable()
          .optional(),
        mortgage: z
          .array(
            z.object({
              ...common,
              next_monthly_payment: optionalAmount,
              interest_rate: z.object({ percentage: Amount }).optional(),
            }),
          )
          .nullable()
          .optional(),
        student: z
          .array(z.object({ ...common, interest_rate_percentage: optionalAmount }))
          .nullable()
          .optional(),
      }),
    })
    .parse(parsePlaid(text));
  const mapped: Record<string, NonNullable<Balance['details']>> = {};
  for (const row of [
    ...(result.liabilities.credit ?? []),
    ...(result.liabilities.mortgage ?? []),
    ...(result.liabilities.student ?? []),
  ]) {
    const account = accounts.find((a) => a.providerRef === row.account_id);
    if (!account) continue;
    const apr =
      'aprs' in row
        ? row.aprs?.find((a) => a.apr_type === 'purchase_apr')?.apr_percentage
        : 'interest_rate' in row
          ? row.interest_rate?.percentage
          : 'interest_rate_percentage' in row
            ? row.interest_rate_percentage
            : undefined;
    mapped[account.id] = {
      source: 'plaid',
      statementBalance: row.last_statement_balance ?? undefined,
      minimumPayment:
        row.minimum_payment_amount ??
        ('next_monthly_payment' in row ? (row.next_monthly_payment ?? undefined) : undefined),
      dueDate: row.next_payment_due_date ?? undefined,
      originalPrincipal: row.origination_principal_amount ?? undefined,
      apr: apr ?? undefined,
    };
  }
  return mapped;
}
