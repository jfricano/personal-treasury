import type { Treasury } from '@/api/treasury';
import type { V3Session } from '@/security/client';
import { gatherWindow, type Review, type Evidence } from '@/domain/spending';
import {
  parsePlaid,
  plaidAccounts,
  plaidRequest,
  plaidTransactions,
  missingPlaidRows,
  plaidLiabilities,
} from './plaid';
export async function gatherPlaid(t: Treasury, session: V3Session, connectionId: string, review: Review) {
  const { vault } = await session.readVault(),
    credential = vault.plaid,
    item = credential?.items.find((i) => i.connectionId === connectionId);
  if (!credential || !item)
    throw new Error('Reconnect this institution; its credential is not in the vault.');
  const window = gatherWindow(review.month, new Date().toISOString().slice(0, 10));
  const accountText = await plaidRequest(credential, '/accounts/get', { access_token: item.accessToken }),
    accountResults = plaidAccounts(accountText, connectionId, t.spending.accounts());
  for (const { account } of accountResults)
    if (!account.confirmed) {
      t.spending.saveAccount(account);
      throw new Error(
        'A new account appeared. Confirm its kind and scope in Connected Accounts, then gather again.',
      );
    }
  const transactions: ReturnType<typeof plaidTransactions> = [];
  let offset = 0,
    total: number;
  do {
    const text = await plaidRequest(credential, '/transactions/get', {
      access_token: item.accessToken,
      start_date: window.start,
      end_date: window.end,
      options: { count: 500, offset },
    });
    const parsed = parsePlaid(text) as { total_transactions: string };
    total = Number(parsed.total_transactions);
    if (!Number.isSafeInteger(total) || total < 0 || total > 100000)
      throw new Error('Provider transaction count is invalid');
    const rows = plaidTransactions(
      text,
      accountResults.map((a) => a.account),
    );
    transactions.push(...rows);
    offset += rows.length;
    if (rows.length === 0 && offset < total)
      throw new Error('Provider returned an incomplete transaction page');
  } while (offset < total);
  const itemText = await plaidRequest(credential, '/item/get', { access_token: item.accessToken });
  const info = parsePlaid(itemText) as {
    status?: { transactions?: { last_successful_update?: string } };
    item?: { consent_expiration_time?: string };
  };
  transactions.push(
    ...missingPlaidRows(
      review.transactions,
      transactions,
      new Set(accountResults.map((a) => a.account.id)),
      window,
    ),
  );
  if ((info as { item?: { billed_products?: string[] } }).item?.billed_products?.includes('liabilities')) {
    const details = plaidLiabilities(
      await plaidRequest(credential, '/liabilities/get', { access_token: item.accessToken }),
      accountResults.map((a) => a.account),
    );
    for (const result of accountResults) result.balance.details = details[result.account.id];
  }
  const evidence: Record<string, Evidence> = {};
  for (const { account, balance } of accountResults) {
    balance.periods = [window];
    evidence[account.id] = {
      source: 'plaid',
      periods: [window],
      gatheredAt: new Date().toISOString(),
      freshness: info.status?.transactions?.last_successful_update,
      historyConfirmed: review.evidence[account.id]?.historyConfirmed,
    };
  }
  const connection = t.spending.connections().find((c) => c.id === connectionId)!;
  t.spending.saveProviderConnection({
    ...connection,
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    status: 'ready',
    consentExpiresAt: info.item?.consent_expiration_time ?? null,
  });
  return {
    transactions,
    evidence,
    balances: Object.fromEntries(accountResults.map((a) => [a.account.id, a.balance])),
  };
}
