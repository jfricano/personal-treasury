import { describe, expect, it } from 'vitest';
import { SqlJsDriver, loadSqlJs } from '@/db/driver';
import { MIGRATIONS, SCHEMA_VERSION, currentVersion, migrate } from '@/db/migrations';
import { normalize } from '@/domain/money';
import { syntheticWorkbook } from '../fixtures/workbooks';
import { freshTreasury, importInto, sampleTreasury } from './helpers';

async function syntheticTreasury() {
  const t = await freshTreasury();
  await importInto(t, syntheticWorkbook(), 'synthetic.xlsx');
  return t;
}

const TABLES = [
  'meta',
  'import_runs',
  'import_warnings',
  'accounts',
  'account_aliases',
  'allocation_profiles',
  'allocation_profile_lines',
  'monthly_cycles',
  'monthly_allocations',
  'journal_entries',
  'journal_postings',
  'debts',
  'debt_events',
  'audit_log',
];

/** Every column that stores money as a normalized decimal string. */
const MONEY_COLUMNS: [string, string][] = [
  ['allocation_profiles', 'expected_cash'],
  ['allocation_profile_lines', 'amount'],
  ['monthly_cycles', 'expected_cash'],
  ['monthly_allocations', 'budget_amount'],
  ['journal_postings', 'amount'],
  ['debt_events', 'change_amount'],
];

describe('database checks', () => {
  it('migrates a fresh database to the current schema with integrity intact', async () => {
    const t = await freshTreasury();
    expect(currentVersion(t.db)).toBe(SCHEMA_VERSION);
    const tables = t.db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((r) => r.name);
    for (const name of TABLES) expect(tables).toContain(name);
    expect(t.db.get<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check).toBe('ok');
    expect(t.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
  });

  it('upgrades a version-1 database in place without touching its rows', async () => {
    const db = new SqlJsDriver(await loadSqlJs());
    db.transaction(() => {
      db.exec(MIGRATIONS[0].sql);
      db.exec('PRAGMA user_version = 1');
    });
    const now = new Date().toISOString();
    db.run(
      "INSERT INTO monthly_cycles(id, month, expected_cash, created_at, updated_at) VALUES ('m', '2026-01', '10', ?, ?)",
      [now, now],
    );
    expect(migrate(db)).toEqual({ from: 1, to: SCHEMA_VERSION });
    expect(
      db.get<{ expected_cash: string }>("SELECT expected_cash FROM monthly_cycles WHERE id = 'm'")!
        .expected_cash,
    ).toBe('10');
    expect(() => db.run("UPDATE monthly_cycles SET month = '2026-00' WHERE id = 'm'")).toThrow(/CHECK/);
  });

  it('is idempotent and refuses databases from a newer application', async () => {
    const db = new SqlJsDriver(await loadSqlJs());
    expect(migrate(db)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this application/);
  });

  it.each([
    ['the sample data', sampleTreasury],
    ['an imported workbook', syntheticTreasury],
  ])('keeps integrity, references and normalized money text with %s', async (_name, make) => {
    const t = await make();
    expect(t.db.get<{ integrity_check: string }>('PRAGMA integrity_check')!.integrity_check).toBe('ok');
    expect(t.db.all('PRAGMA foreign_key_check')).toEqual([]);
    for (const [table, column] of MONEY_COLUMNS) {
      const bad = t.db
        .all<{ v: unknown; ty: string }>(`SELECT ${column} v, typeof(${column}) ty FROM ${table}`)
        .filter((r) => r.ty !== 'text' || normalize(String(r.v)) !== r.v);
      expect(bad, `${table}.${column}`).toEqual([]);
    }
    // Pragmas survive a snapshot/export (sql.js reopens the database on export).
    t.db.export();
    expect(t.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
  });

  it('enforces the documented constraints', async () => {
    const t = await sampleTreasury();
    const now = new Date().toISOString();
    expect(() =>
      t.db.run(
        "INSERT INTO accounts(id, code, sort_order, created_at, updated_at) VALUES ('x', 'hh', 99, ?, ?)",
        [now, now],
      ),
    ).toThrow(/UNIQUE/);
    const d = t.repos.listDebts()[0];
    expect(() =>
      t.db.run(
        'INSERT INTO debts(id, loan_id, opened_date, origin_debtor_account_id, origin_creditor_account_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        ['y', d.loanId, '2026-01-01', d.originDebtorAccountId, d.originCreditorAccountId, now, now],
      ),
    ).toThrow(/UNIQUE/);
    const m = t.repos.listMonths()[0];
    expect(() =>
      t.db.run("UPDATE monthly_allocations SET transfer_state = 'maybe' WHERE monthly_cycle_id = ?", [m.id]),
    ).toThrow(/CHECK/);
    expect(() =>
      t.db.run(
        "INSERT INTO journal_postings(id, journal_entry_id, account_id, amount, position) VALUES ('z', 'missing', 'missing', '1', 0)",
      ),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      t.db.run(
        "INSERT INTO monthly_cycles(id, month, expected_cash, created_at, updated_at) VALUES ('w', '2026-13', '0', ?, ?)",
        [now, now],
      ),
    ).toThrow(/CHECK/);
  });
});
