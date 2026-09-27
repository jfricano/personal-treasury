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
  ]) {
    delete backup.tables[name];
    delete backup.counts[name];
  }
  const db = new SqlJsDriver(await loadSqlJs(), buildDatabaseFromBackup(await loadSqlJs(), backup));
  expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(4);
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
