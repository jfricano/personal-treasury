import * as XLSX from 'xlsx';
import { exportSpendingReport } from '@/export/spendingReport';
import { describe, it, expect } from 'vitest';
import {
  exactAmount,
  latePostingChanges,
  reportGroups,
  lineYearToDate,
  postedDate,
  coverage,
  dispositionErrors,
  mergeTransactions,
  possibleDuplicates,
  normalizedDescription,
  clearBlockers,
  buildReport,
  reportTotals,
  balanceSnapshot,
  monthPeriod,
  type InstitutionAccount,
  type Review,
  type ReviewBudget,
  type Transaction,
} from '@/domain/spending';
import { MemoryReviewBackend, ReviewStore } from '@/review-store';
import { parseCsvStatement, parseOfx } from '@/import/statements';
const account: InstitutionAccount = {
  id: 'a',
  connectionId: 'c',
  providerRef: 'a',
  displayName: 'Checking',
  mask: '1111',
  kind: 'checking',
  inReview: true,
  inSnapshot: true,
  confirmed: true,
  treasuryAccountId: null,
  shared: true,
  active: true,
  csvProfile: null,
};
const tx = (patch: Partial<Transaction> = {}): Transaction => ({
  id: 't',
  institutionAccountId: 'a',
  source: { kind: 'file', name: 'sample.csv', hash: 'one' },
  postedDate: '2026-08-10',
  amount: '-120',
  sourceAmount: '-120',
  description: 'CANARY purchase',
  pending: false,
  removedAtSource: false,
  disposition: {
    kind: 'budget',
    state: 'accepted',
    parts: [
      { lineKey: 'g', amount: '-80' },
      { lineKey: 'r', amount: '-40' },
    ],
  },
  ...patch,
});
const budget: ReviewBudget = {
  id: 'b',
  label: 'August',
  takeHome: '1000',
  lines: [
    {
      lineKey: 'g',
      label: 'Groceries',
      category: 'Household',
      fundingAccountId: null,
      fundingAccount: '',
      role: 'spending',
      planned: '100',
    },
    {
      lineKey: 'r',
      label: 'Rest',
      category: 'Other',
      fundingAccountId: null,
      fundingAccount: '',
      role: 'spending',
      planned: '900',
    },
  ],
};
function review(): Review {
  return {
    ref: crypto.randomUUID(),
    month: '2026-08',
    budgetVersionId: 'b',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    timeZone: 'America/Los_Angeles',
    settleDays: 3,
    pairingDays: 5,
    transactions: [tx()],
    evidence: { a: { source: 'file', periods: [monthPeriod('2026-08')], gatheredAt: '2026-09-04' } },
    balances: { a: { value: '2400', asOf: '2026-08-31', unavailable: false, periods: [] } },
    importedHashes: [],
    note: '',
  };
}
describe('V3 spending contract', () => {
  it('preserves exact decimals and rejects exponent, excess precision and invalid amounts', () => {
    expect(exactAmount('-12.345')).toBe('-12.345');
    expect(exactAmount('9007199254740993.25')).toBe('9007199254740993.25');
    for (const v of ['1e3', '12.34567', 'NaN', 'Infinity']) expect(() => exactAmount(v)).toThrow();
  });
  it('uses household dates except midnight UTC date encoding', () => {
    expect(postedDate('2026-09-01T06:30:00Z', 'America/Los_Angeles')).toBe('2026-08-31');
    expect(postedDate('2026-09-01T00:00:00Z', 'America/Los_Angeles')).toBe('2026-09-01');
  });
  it('finds one-day gaps and requires provider freshness and history', () => {
    const e = review().evidence.a;
    e.periods = [
      { start: '2026-08-01', end: '2026-08-15' },
      { start: '2026-08-17', end: '2026-08-31' },
    ];
    expect(coverage('2026-08', e, [], 3).reason).toContain('2026-08-16');
    e.periods.push({ start: '2026-08-16', end: '2026-08-16' });
    expect(coverage('2026-08', e, [], 3).status).toBe('complete');
    e.source = 'plaid';
    e.freshness = '2026-09-01';
    expect(coverage('2026-08', e, [], 3).reason).toBe('Not fresh enough');
    e.freshness = '2026-09-04';
    expect(coverage('2026-08', e, [], 3).reason).toBe('Confirm history');
    e.historyConfirmed = true;
    expect(coverage('2026-08', e, [], 3).status).toBe('complete');
  });
  it('rejects split mismatches, opposite signs, outflow income and note-free other exclusions', () => {
    const t = tx();
    expect(dispositionErrors(t, t.disposition, new Set(['g', 'r']), [t])).toEqual([]);
    for (const d of [
      { kind: 'budget', state: 'accepted', parts: [{ lineKey: 'g', amount: '-119.99' }] },
      { kind: 'budget', state: 'accepted', parts: [{ lineKey: 'g', amount: '120' }] },
      { kind: 'income', state: 'accepted', incomeKind: 'take_home' },
      { kind: 'excluded', state: 'accepted', reason: 'other' },
    ] as const)
      expect(
        dispositionErrors(t, structuredClone(d) as Transaction['disposition'], new Set(['g', 'r']), [t])
          .length,
      ).toBeGreaterThan(0);
  });
  it('revalidates corrected amounts and distinguishes identical file occurrences from cross-source duplicates', () => {
    const next = mergeTransactions([tx()], [tx({ amount: '-125' })]);
    expect(next[0].disposition?.state).toBe('suggested');
    expect(possibleDuplicates([tx(), tx({ id: 'other' })])).toEqual([]);
    expect(
      possibleDuplicates([tx(), tx({ id: 'other', source: { kind: 'plaid', name: 'plaid' } })]),
    ).toHaveLength(1);
  });
  it('does not waive posted activity or allow pending classifications', () => {
    const r = review();
    r.evidence.a.waiver = { reason: 'no activity', note: 'Checked' };
    expect(clearBlockers(r, [account], budget).some((b) => b.message.includes('cannot be waived'))).toBe(
      true,
    );
    expect(dispositionErrors(tx({ pending: true }), tx().disposition, new Set(['g', 'r']), [])).toContain(
      'Pending transactions cannot be classified',
    );
  });
  it('builds a report without descriptions, source IDs or raw individual amounts', () => {
    const report = buildReport(review(), [account], budget);
    expect(report.lines.map((l) => l.actual)).toEqual(['80', '40']);
    expect(reportTotals(report).actual).toBe('120');
    expect(JSON.stringify(report)).not.toContain('CANARY purchase');
    expect(report.sources[0].count).toBe(1);
  });
  it('blocks every incomplete clear condition', () => {
    for (const mutate of [
      (r: Review) => {
        r.budgetVersionId = '';
      },
      (r: Review) => {
        delete r.evidence.a;
      },
      (r: Review) => {
        delete r.transactions[0].disposition;
      },
      (r: Review) => {
        r.transactions[0].removedAtSource = true;
      },
      (r: Review) => {
        delete r.balances.a;
      },
      (r: Review) => {
        r.transactions[0].disposition = {
          kind: 'budget',
          state: 'accepted',
          parts: [{ lineKey: 'g', amount: '-119.99' }],
        };
      },
    ]) {
      const r = review();
      mutate(r);
      expect(clearBlockers(r, [account], r.budgetVersionId ? budget : null).length).toBeGreaterThan(0);
      expect(() =>
        buildReport(r, [account], r.budgetVersionId ? budget : { ...budget, lines: [] }),
      ).toThrow();
    }
  });
  it('estimates only with complete post-month coverage and never estimates investments', () => {
    const r = review();
    r.transactions.push(tx({ id: 'after', postedDate: '2026-09-04', amount: '-350' }));
    const b = {
      value: '2400',
      asOf: '2026-09-05',
      unavailable: false,
      periods: [{ start: '2026-09-01', end: '2026-09-05' }],
    };
    expect(balanceSnapshot(account, b, r).value).toBe('2750');
    expect(balanceSnapshot({ ...account, kind: 'brokerage' }, b, r).estimate).toBe(false);
    b.periods[0].end = '2026-09-03';
    expect(balanceSnapshot(account, b, r).estimate).toBe(false);
  });
  it('normalizes merchant reference numbers for explicit rules', () =>
    expect(normalizedDescription(' harbor market #1234  Maple ')).toBe('HARBOR MARKET ## MAPLE'));
});
describe('V3 temporary review lifecycle', () => {
  it('saves through reload, supports one-step undo, and never resurrects cleared data', async () => {
    const backend = new MemoryReviewBackend(),
      store = new ReviewStore(backend);
    await store.load();
    const r = store.create('2026-08', 'b');
    store.edit(r.ref, (r) => {
      r.transactions = [tx()];
    });
    await store.flush();
    const reloaded = new ReviewStore(backend);
    await reloaded.load();
    expect(reloaded.get(r.ref)?.transactions).toHaveLength(1);
    store.undo(r.ref);
    expect(store.get(r.ref)?.transactions).toHaveLength(0);
    store.edit(r.ref, (r) => {
      r.transactions = [tx()];
    });
    await store.finish(r.ref, 'cleared', async () => undefined);
    expect(store.get(r.ref)).toBeNull();
    expect(store.undo(r.ref)).toBe(false);
    expect(backend.value).not.toContain('CANARY');
    expect(() => store.edit(r.ref, () => undefined)).toThrow();
  });
  it('retains data on failed upload and deletes it on retry', async () => {
    const backend = new MemoryReviewBackend(),
      store = new ReviewStore(backend);
    await store.load();
    const r = store.create('2026-08', 'b');
    store.edit(r.ref, (r) => {
      r.transactions = [tx()];
    });
    await expect(
      store.finish(r.ref, 'cleared', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(store.entries()[0].state).toBe('awaiting_upload');
    expect(store.get(r.ref)?.transactions).toHaveLength(1);
    await store.finish(r.ref, 'cleared', async () => undefined);
    expect(store.get(r.ref)).toBeNull();
  });
  it('expires idle reviews at 14 days and changed reviews by 45 days', async () => {
    let clock = new Date('2026-09-01');
    const backend = new MemoryReviewBackend(),
      store = new ReviewStore(backend, () => clock);
    await store.load();
    const r = store.create('2026-08', 'b');
    clock = new Date('2026-09-08');
    expect(store.warning(r.ref)).toBeTruthy();
    clock = new Date('2026-09-15');
    expect(store.get(r.ref)).toBeNull();
    expect(store.entries()[0].state).toBe('expired');
  });
});
describe('statement sources', () => {
  it('keeps identical CSV occurrences distinct and respects explicit sign mapping', async () => {
    const s = await parseCsvStatement(
      'Date,Description,Amount\n2026-08-02,Shop,12.345\n2026-08-02,Shop,12.345',
      'test.csv',
      'a',
      { date: 'Date', description: 'Description', amount: 'Amount', outflowPositive: true },
      monthPeriod('2026-08'),
    );
    expect(s.transactions.map((t) => t.amount)).toEqual(['-12.345', '-12.345']);
    expect(s.transactions[0].id).not.toBe(s.transactions[1].id);
  });
  it('parses SGML OFX, preserves posted dates, and rejects truncated files atomically', async () => {
    const text =
      '<OFX><STMTRS><BANKTRANLIST><DTSTART>20260801\n<DTEND>20260831\n<STMTTRN><DTPOSTED>20260802120000[-7:PDT]\n<TRNAMT>-12.345\n<FITID>one\n<NAME>Shop\n</STMTTRN></BANKTRANLIST></STMTRS></OFX>';
    const s = await parseOfx(text, 'test.ofx', 'a');
    expect(s.transactions[0].postedDate).toBe('2026-08-02');
    expect(s.transactions[0].amount).toBe('-12.345');
    await expect(parseOfx(text.replace('</OFX>', ''), 'bad.ofx', 'a')).rejects.toThrow('Truncated');
  });
});

import { plaidTransactions, plaidAccounts, guardTrial } from '@/sources/plaid';
it('V3-AT15 preserves provider number text beyond IEEE range and canonicalizes card signs', () => {
  const rows = plaidTransactions(
    '{"transactions":[{"transaction_id":"p","account_id":"a","date":"2026-08-02","amount":9007199254740993.25,"name":"Purchase","pending":false}]}',
    [account],
  );
  expect(rows[0].amount).toBe('-9007199254740993.25');
  const result = plaidAccounts(
    '{"accounts":[{"account_id":"card","name":"Card","mask":"1234","type":"credit","subtype":"credit card","balances":{"current":812.40}}]}',
    'connection',
  );
  expect(result[0].balance.value).toBe('-812.4');
  expect(result[0].account.confirmed).toBe(false);
  expect(() =>
    guardTrial(
      { clientId: 'test', secret: 'test', environment: 'production', items: [], productionItemsUsed: 10 },
      'new',
    ),
  ).toThrow('TRIAL_CONNECTION_LIMIT');
});

it('late posting comparison requires a complete prior tail and detects exact count or sum changes only', () => {
  const original = review();
  original.transactions = [tx({ postedDate: '2026-08-25' })];
  const report = buildReport(original, [account], budget),
    next = review();
  next.month = '2026-09';
  next.transactions = [
    tx({ postedDate: '2026-08-25' }),
    tx({ id: 'late', postedDate: '2026-08-31', amount: '-0.01' }),
  ];
  next.evidence.a.periods = [{ start: '2026-08-25', end: '2026-09-30' }];
  expect(latePostingChanges(next, [report])).toEqual([
    { month: '2026-08', account: 'Checking', countChange: 1, amountChange: '-0.01' },
  ]);
  next.evidence.a.periods = [{ start: '2026-08-26', end: '2026-09-30' }];
  expect(latePostingChanges(next, [report])).toEqual([]);
  next.evidence.a.periods = [{ start: '2026-08-25', end: '2026-09-30' }];
  next.transactions = [
    tx({ postedDate: '2026-08-25' }),
    tx({ id: 'earlier', postedDate: '2026-08-24', amount: '-20' }),
  ];
  expect(latePostingChanges(next, [report])).toEqual([]);
});
it('cleared XLSX exports preserve text cells and aggregates; only an explicit working export includes transaction details', () => {
  const raw = review();
  raw.transactions[0].description = '=CANARY(1)';
  const report = buildReport(raw, [account], budget);
  report.lines[0].note = '=1+1';
  const cleared = XLSX.read(exportSpendingReport(report, [report]), { type: 'array', cellNF: true });
  expect(cleared.SheetNames).not.toContain('Transactions');
  expect(JSON.stringify(cleared)).not.toContain('CANARY');
  const lineRows = XLSX.utils.sheet_to_json(cleared.Sheets.Lines) as Record<string, unknown>[];
  expect(lineRows[0]['YTD actual']).toBe(80);
  expect(lineRows[0]['Note']).toBe('=1+1');
  expect(cleared.Sheets.Lines.L2.t).toBe('s');
  expect(cleared.Sheets.Lines.L2.f).toBeUndefined();
  expect(cleared.Sheets.Lines.F2.z).toContain('0.00');
  const detailed = XLSX.read(exportSpendingReport(report, [report], raw), { type: 'array' });
  expect(detailed.Sheets.Transactions.C2.v).toBe('=CANARY(1)');
  expect(detailed.Sheets.Transactions.C2.t).toBe('s');
  expect(detailed.Sheets.Transactions.C2.f).toBeUndefined();
  report.lines[1].role = 'set_aside';
  expect(reportGroups(report, 'category').map((g) => g.role)).toEqual(['spending', 'set_aside']);
  expect(lineYearToDate([report], '2026-08', 'g')).toEqual({ planned: '100', actual: '80' });
});

it('provider freshness settles in the household calendar rather than at UTC midnight', () => {
  const evidence = {
    source: 'plaid' as const,
    periods: [monthPeriod('2026-08')],
    gatheredAt: '2026-09-03T00:00:00Z',
    historyConfirmed: true,
  };
  expect(coverage('2026-08', evidence, [], 3, 'UTC').status).toBe('complete');
  expect(coverage('2026-08', evidence, [], 3, 'America/Los_Angeles').status).toBe('partial');
  expect(
    coverage('2026-08', { ...evidence, freshness: '2026-09-03T08:00:00Z' }, [], 3, 'America/Los_Angeles')
      .status,
  ).toBe('complete');
  expect(coverage('2026-08', { ...evidence, freshness: 'invalid' }, [], 3, 'UTC').status).toBe('error');
});
