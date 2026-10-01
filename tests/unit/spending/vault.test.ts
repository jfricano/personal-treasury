import { it, expect } from 'vitest';
import { VaultOutbox } from '@/security/vaultOutbox';
import { MemoryStorage } from '@/db/storage';
import { importDataKey, random, type Envelope } from '@/security/crypto';
import { SecurityError } from '@/security/client';
import {
  hostedLinkResult,
  missingPlaidRows,
  plaidLiabilities,
  guardTrial,
  countLinkAttempt,
  abandonPendingLink,
  type ProviderVault,
} from '@/sources/plaid';
import type { InstitutionAccount, Transaction } from '@/domain/spending';
const vault: ProviderVault = {
  plaid: {
    clientId: 'client',
    secret: 'CREDENTIAL CANARY',
    environment: 'production',
    items: [],
    productionItemsUsed: 1,
  },
};
it('a failed vault acknowledgement retains only encrypted data; read resumes or recognizes the accepted write', async () => {
  const local = new MemoryStorage(),
    key = await importDataKey(random());
  let revision = 0,
    envelope: Envelope | undefined,
    attempts = 0;
  const client = {
    async request<T>(_path: string, method = 'GET', body?: unknown, expected?: number): Promise<T> {
      if (method === 'PUT') {
        attempts++;
        expect(expected).toBe(revision);
        revision++;
        envelope = (body as { envelope: Envelope }).envelope;
        throw new TypeError('Acknowledgement lost');
      }
      return { revision, envelope } as T;
    },
  };
  const outbox = new VaultOutbox(local, client, key, 'fixture', '1');
  await expect(outbox.write(vault, 0)).rejects.toThrow('Acknowledgement lost');
  expect(new TextDecoder().decode((await local.load('v3-vault-outbox:fixture'))!)).not.toContain('CANARY');
  expect((await outbox.read()).vault).toEqual(vault);
  expect(attempts).toBe(1);
  expect(await local.load('v3-vault-outbox:fixture')).toBeNull();
});
it('a conflicting cloud vault keeps the encrypted outgoing credential instead of overwriting either copy', async () => {
  const local = new MemoryStorage(),
    key = await importDataKey(random());
  const client = {
    async request<T>(_path: string, method = 'GET'): Promise<T> {
      if (method === 'PUT') throw new SecurityError(409, 'revision_conflict', 0);
      return { revision: 2 } as T;
    },
  };
  const outbox = new VaultOutbox(local, client, key, 'fixture', '1');
  await expect(outbox.write(vault, 0)).rejects.toThrow();
  await expect(outbox.read()).rejects.toThrow('another device');
  expect(await local.load('v3-vault-outbox:fixture')).not.toBeNull();
});
it('Hosted Link rejects a wrong or ambiguous institution before token exchange; Trial reservations count against the cap', () => {
  const response = (ids: string[]) =>
    JSON.stringify({
      link_sessions: [
        {
          results: {
            item_add_results: ids.map((institution_id) => ({
              public_token: 'public-token',
              institution: { institution_id },
            })),
          },
        },
      ],
    });
  expect(hostedLinkResult(response(['ins_fixture']), 'ins_fixture')).toBe('public-token');
  expect(() => hostedLinkResult(response(['ins_other']), 'ins_fixture')).toThrow('different institution');
  expect(() => hostedLinkResult(response(['ins_fixture', 'ins_fixture']), 'ins_fixture')).toThrow(
    'exactly one',
  );
  expect(() =>
    guardTrial(
      { ...vault.plaid!, productionItemsUsed: 9, pendingLink: { reservation: true } as never },
      'ins_fixture',
    ),
  ).toThrow('LIMIT');
});
it('only absent provider rows in a completely gathered account/window are marked removed, and liability decimals remain exact', () => {
  const account = { id: 'a', providerRef: 'provider-a' } as InstitutionAccount;
  const row = {
    id: 'one',
    institutionAccountId: 'a',
    source: { kind: 'plaid', name: 'plaid' },
    postedDate: '2026-08-12',
  } as Transaction;
  expect(
    missingPlaidRows(
      [
        row,
        { ...row, id: 'outside', postedDate: '2026-07-01' },
        { ...row, id: 'file', source: { kind: 'file', name: 'file' } },
      ],
      [],
      new Set(['a']),
      { start: '2026-08-01', end: '2026-08-31' },
    ).map((t) => t.id),
  ).toEqual(['one']);
  const details = plaidLiabilities(
    '{"liabilities":{"credit":[{"account_id":"provider-a","last_statement_balance":9007199254740993.25,"minimum_payment_amount":12.345,"next_payment_due_date":"2026-09-15","aprs":[{"apr_type":"purchase_apr","apr_percentage":17.25}]}]}}',
    [account],
  );
  expect(details.a).toMatchObject({
    source: 'plaid',
    statementBalance: '9007199254740993.25',
    minimumPayment: '12.345',
    dueDate: '2026-09-15',
    apr: '17.25',
  });
});

it('uncertain Hosted Link opens consume lifetime slots before retries and abandoning never refunds them', () => {
  const c = {
    ...vault.plaid!,
    productionItemsUsed: 8,
    pendingLink: {
      linkToken: 'link',
      hostedUrl: 'https://secure.plaid.com/link',
      connectionId: 'connection',
      reconnect: false,
      institutionId: 'ins',
      displayName: 'Fixture',
      reservation: true,
      counted: false,
    },
  };
  const first = countLinkAttempt(c);
  expect(first.productionItemsUsed).toBe(9);
  expect(first.pendingLink?.reservation).toBe(false);
  const retry = countLinkAttempt(first);
  expect(retry.productionItemsUsed).toBe(10);
  expect(() => countLinkAttempt(retry)).toThrow('LIMIT');
  expect(abandonPendingLink(retry).productionItemsUsed).toBe(10);
  expect(abandonPendingLink(c).productionItemsUsed).toBe(9);
  expect(() =>
    countLinkAttempt({ ...first, pendingLink: { ...first.pendingLink!, publicToken: 'token' } }),
  ).toThrow('completed');
  expect(
    countLinkAttempt({ ...first, pendingLink: { ...first.pendingLink!, reconnect: true } })
      .productionItemsUsed,
  ).toBe(9);
});

it('provider loan subtypes use debt signs and preserve balance source/capture metadata', async () => {
  const { plaidAccounts } = await import('@/sources/plaid');
  const rows = plaidAccounts(
    JSON.stringify({
      accounts: ['student', 'auto', 'mortgage'].map((subtype) => ({
        account_id: subtype,
        name: 'Fixture loan',
        mask: null,
        type: 'loan',
        subtype,
        balances: { current: 12.345, iso_currency_code: 'USD' },
      })),
    }),
    'connection',
  );
  expect(rows.map((r) => r.account.kind)).toEqual(['student_loan', 'auto_loan', 'mortgage']);
  expect(rows.every((r) => !r.account.inReview && r.account.inSnapshot)).toBe(true);
  expect(
    rows.every(
      (r) => r.balance.value === '-12.345' && r.balance.source === 'plaid' && !!r.balance.capturedAt,
    ),
  ).toBe(true);
});
it('the default review month is the latest uncleared completed calendar month across a year boundary', async () => {
  const { latestUnclearedMonth } = await import('@/domain/spending');
  expect(latestUnclearedMonth([], new Date(2026, 0, 15))).toBe('2025-12');
  expect(latestUnclearedMonth([{ month: '2025-12' }, { month: '2025-11' }], new Date(2026, 0, 15))).toBe(
    '2025-10',
  );
});
