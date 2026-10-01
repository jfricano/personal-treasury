import { it, expect } from 'vitest';
import { sampleTreasury } from './helpers';
import { buildDatabaseFromBackup, createBackup } from '@/export/backup';
import { loadSqlJs, SqlJsDriver } from '@/db/driver';
import { MemoryReviewBackend, ReviewStore } from '@/review-store';
import { monthPeriod } from '@/domain/spending';
it('migrates a schema-3 JSON backup and preserves stable line keys across restored versions', async () => {
  const t = await sampleTreasury(),
    backup = createBackup(t.db);
  backup.schemaVersion = 3;
  for (const row of backup.tables.budget_lines) delete row.line_key;
  for (const name of [
    'connections',
    'institution_accounts',
    'categorization_rules',
    'spending_line_settings',
    'spending_reports',
    'spending_report_lines',
    'spending_report_flows',
    'spending_report_sources',
    'balance_snapshots',
    'spending_source_periods',
  ]) {
    delete backup.tables[name];
    delete backup.counts[name];
  }
  const db = new SqlJsDriver(await loadSqlJs(), buildDatabaseFromBackup(await loadSqlJs(), backup));
  expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(5);
  expect(
    db.get<{ n: number }>("SELECT count(*) n FROM budget_lines WHERE line_key IS NULL OR line_key=''")?.n,
  ).toBe(0);
  expect(db.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check).toBe('ok');
  expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
});
it('cleared report backup and SQLite contain aggregates only; report undo cannot resurrect review details', async () => {
  const t = await sampleTreasury(),
    connectionId = t.spending.addConnection('Fictional statements');
  t.spending.saveAccount({
    id: 'a',
    connectionId,
    providerRef: 'a',
    displayName: 'Checking',
    mask: '1111',
    kind: 'checking',
    inReview: true,
    inSnapshot: false,
    confirmed: true,
    treasuryAccountId: null,
    shared: true,
    active: true,
    csvProfile: null,
  });
  const backend = new MemoryReviewBackend(),
    store = new ReviewStore(backend);
  await store.load();
  const version = t.budget.repos.listVersions().find((v) => v.detailLevel === 'full')!;
  const r = store.create('2026-08', version.id);
  store.edit(r.ref, (r) => {
    r.evidence.a = { periods: [monthPeriod(r.month)], source: 'file', gatheredAt: '2026-09-04T00:00:00Z' };
    r.transactions = [
      {
        id: 'PRIVATE-TRANSACTION-ID-CANARY',
        institutionAccountId: 'a',
        source: { kind: 'file', name: 'PRIVATE-SOURCE-CANARY.csv', hash: 'PRIVATE-HASH-CANARY' },
        postedDate: '2026-08-08',
        amount: '-123.45',
        sourceAmount: '123.4500',
        description: 'PRIVATE-DESCRIPTION-CANARY',
        pending: false,
        removedAtSource: false,
        disposition: { kind: 'unbudgeted', state: 'accepted' },
      },
    ];
  });
  const report = t.spending.clear(store.get(r.ref)!);
  expect(report.unbudgeted.actual).toBe('123.45');
  await store.finish(r.ref, 'cleared', () => t.flush());
  for (const value of [
    JSON.stringify(createBackup(t.db)),
    new TextDecoder().decode(t.db.export()),
    backend.value!,
  ])
    expect(value).not.toContain('CANARY');
  expect(t.spending.reports()).toHaveLength(1);
  t.undo();
  expect(t.spending.reports()).toHaveLength(0);
  expect(store.get(r.ref)).toBeNull();
});

it('upgrades schema-4 preview JSON records to columns without losing decimals, mappings, liability details or source windows', async () => {
  const { migrate } = await import('@/db/migrations');
  const { fromColumns } = await import('@/db/spendingColumns');
  const SQL = await loadSqlJs(),
    db = new SqlJsDriver(SQL);
  migrate(db, 4);
  const connection = {
    id: 'connection',
    provider: 'file',
    displayName: 'Fictional bank',
    status: 'ready',
    credentialRef: null,
    providerRef: null,
    lastSuccessAt: null,
    lastError: null,
    consentExpiresAt: null,
  };
  const account = {
    id: 'a',
    connectionId: connection.id,
    providerRef: 'a',
    displayName: 'Card',
    mask: '1111',
    kind: 'credit_card',
    inReview: true,
    inSnapshot: true,
    confirmed: true,
    treasuryAccountId: null,
    shared: false,
    active: true,
    csvProfile: {
      date: 'Date',
      description: 'Memo',
      debit: 'Debit',
      credit: 'Credit',
      outflowPositive: false,
    },
  };
  const rule = {
    id: 'rule',
    position: 2,
    enabled: true,
    createdAt: '2026-09-01',
    pattern: 'fixture pattern',
    match: 'contains',
    direction: 'outflow',
    min: '0.001',
    action: { kind: 'budget', lineKey: 'stable' },
  };
  const header = {
    month: '2026-08',
    budgetVersionId: null,
    budgetLabel: 'Historic plan',
    clearedAt: '2026-09-04T00:00:00Z',
    timeZone: 'UTC',
    appVersion: '0.3.0-preview.1',
    settleDays: 3,
    pairingDays: 7,
    count: 1,
    inflows: '0',
    outflows: '9007199254740993.25',
    note: 'Report note',
    unbudgeted: { actual: '0', count: 0 },
    income: { planned: '100', takeHome: '100', other: '0', count: 1 },
  };
  const source = {
    accountId: 'a',
    label: 'Card',
    kind: 'credit_card',
    source: 'file',
    status: 'Complete',
    waiver: '',
    historyConfirmed: true,
    count: 1,
    inflows: '0',
    outflows: '9007199254740993.25',
    tailCount: 1,
    tailSum: '-0.001',
    periods: [
      { start: '2026-07-25', end: '2026-09-04' },
      { start: '2026-08-01', end: '2026-08-31' },
    ],
  };
  const balance = {
    accountId: 'a',
    label: 'Card',
    kind: 'credit_card',
    value: '-9007199254740993.25',
    asOf: '2026-08-31',
    estimate: true,
    unavailable: false,
    details: {
      statementBalance: '9007199254740993.25',
      minimumPayment: '0.001',
      dueDate: '2026-09-15',
      source: 'manual',
    },
  };
  db.run('INSERT INTO connections(id,data) VALUES(?,?)', [connection.id, JSON.stringify(connection)]);
  db.run('INSERT INTO institution_accounts(id,connection_id,treasury_account_id,data) VALUES(?,?,?,?)', [
    'a',
    connection.id,
    null,
    JSON.stringify(account),
  ]);
  db.run('INSERT INTO categorization_rules(id,data) VALUES(?,?)', [rule.id, JSON.stringify(rule)]);
  db.run('INSERT INTO spending_reports(month,budget_version_id,data) VALUES(?,?,?)', [
    header.month,
    null,
    JSON.stringify(header),
  ]);
  for (const [table, value] of [
    ['spending_report_sources', source],
    ['balance_snapshots', balance],
  ] as const)
    db.run(`INSERT INTO ${table}(month,position,data) VALUES(?,?,?)`, [
      header.month,
      0,
      JSON.stringify(value),
    ]);
  migrate(db);
  const read = (table: Parameters<typeof fromColumns>[0]) =>
    fromColumns(table, db.get<Record<string, string | number | null>>(`SELECT * FROM ${table}`)!);
  expect(read('connections')).toEqual(connection);
  expect(read('institution_accounts')).toEqual(account);
  expect(read('categorization_rules')).toEqual(rule);
  expect(read('spending_reports')).toEqual(header);
  expect(read('balance_snapshots')).toEqual(balance);
  const { periods, ...sourceFields } = source;
  expect(read('spending_report_sources')).toEqual(sourceFields);
  expect(
    db
      .all<{ start_date: string; end_date: string }>(
        'SELECT * FROM spending_source_periods ORDER BY position',
      )
      .map((p) => ({ start: p.start_date, end: p.end_date })),
  ).toEqual(periods);
  for (const table of [
    'connections',
    'institution_accounts',
    'categorization_rules',
    'spending_reports',
    'spending_report_lines',
    'spending_report_sources',
    'balance_snapshots',
  ])
    expect(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name)).not.toContain('data');
  const backup = createBackup(db),
    restored = new SqlJsDriver(SQL, buildDatabaseFromBackup(SQL, backup));
  expect(createBackup(restored).tables).toEqual(backup.tables);
  expect(restored.all('PRAGMA foreign_key_check')).toEqual([]);
  db.run('DELETE FROM spending_reports WHERE month=?', [header.month]);
  expect(db.all('SELECT * FROM spending_source_periods')).toEqual([]);
});
