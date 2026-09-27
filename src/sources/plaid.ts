import { parse } from 'lossless-json';
import { z } from 'zod';
import {
  exactAmount,
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
          ? 'loan'
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
          : ['credit_card', 'loan'].includes(kind)
            ? neg(a.balances.current)
            : a.balances.current,
      asOf,
      unavailable: false,
      periods: [],
    };
    return { account, balance };
  });
}
export interface PlaidCredential {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'production';
  items: { connectionId: string; accessToken: string; itemId: string; institutionId: string }[];
  productionItemsUsed: number;
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
  if (credential.environment === 'production' && credential.productionItemsUsed >= 10)
    throw new Error('TRIAL_CONNECTION_LIMIT: all ten lifetime Items have been used. Use statement files.');
}
