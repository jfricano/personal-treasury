import { z } from 'zod';
import type { SqlJsStatic } from 'sql.js';
import { SqlJsDriver, type SqlDriver } from '@/db/driver';
import { SCHEMA_VERSION, migrate } from '@/db/migrations';

export const BACKUP_FORMAT = 'personal-treasury-backup';

/** Parent tables first so foreign keys resolve during restore. */
export const BACKUP_TABLES = [
  'meta',
  'import_runs',
  'import_warnings',
  'accounts',
  'account_aliases',
  'allocation_profiles',
  'allocation_profile_lines',
  'budget_categories',
  'budget_versions',
  'payroll_deductions',
  'payroll_withholdings',
  'budget_lines',
  'budget_summary_rows',
  'tax_rule_sets',
  'monthly_cycles',
  'monthly_allocations',
  'journal_entries',
  'journal_postings',
  'debts',
  'debt_events',
  'audit_log',
] as const;

const Row = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  application: z.string(),
  counts: z.record(z.string(), z.number()),
  tables: z.record(z.string(), z.array(Row)),
});
export type BackupFile = z.infer<typeof BackupSchema>;

export function createBackup(db: SqlDriver): BackupFile {
  const tables: Record<string, Record<string, string | number | null>[]> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = db.all<Record<string, string | number | null>>(`SELECT * FROM ${t} ORDER BY rowid`);
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    application: 'Personal Treasury 0.1.0',
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    tables,
  };
}

export interface RestoreSummary {
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
}

/** Validate a backup file without touching any database. */
export function readBackup(json: string): { backup: BackupFile; summary: RestoreSummary } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const r = BackupSchema.safeParse(data);
  if (!r.success) throw new Error(`This is not a Personal Treasury backup: ${r.error.issues[0]?.message}`);
  const b = r.data;
  if (b.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `The backup uses schema version ${b.schemaVersion}, newer than this application supports (${SCHEMA_VERSION}). Nothing was restored.`,
    );
  }
  for (const t of Object.keys(b.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(t))
      throw new Error(`Backup contains an unknown table “${t}”. Nothing was restored.`);
  }
  for (const [t, rows] of Object.entries(b.tables)) {
    if ((b.counts[t] ?? rows.length) !== rows.length)
      throw new Error(`Backup table ${t} is incomplete (${rows.length} of ${b.counts[t]} rows).`);
  }
  return {
    backup: b,
    summary: { schemaVersion: b.schemaVersion, exportedAt: b.exportedAt, counts: b.counts },
  };
}

/**
 * Build a brand-new database from a backup in a single transaction and return
 * its SQLite bytes. Any failure throws before the live database is touched.
 */
export function buildDatabaseFromBackup(SQL: SqlJsStatic, backup: BackupFile): Uint8Array {
  const db = new SqlJsDriver(SQL);
  // Only schema versions <= current are accepted (readBackup); v1 is the sole version today.
  migrate(db);
  db.transaction(() => {
    for (const t of BACKUP_TABLES) {
      const rows = backup.tables[t] ?? [];
      if (!rows.length) continue;
      const cols = new Set(db.all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name));
      for (const row of rows) {
        const keys = Object.keys(row);
        for (const k of keys)
          if (!cols.has(k))
            throw new Error(`Backup column ${t}.${k} is not part of schema ${SCHEMA_VERSION}.`);
        db.run(
          `INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map((k) => row[k]),
        );
      }
    }
    const fk = db.all('PRAGMA foreign_key_check');
    if (fk.length) throw new Error(`Backup has ${fk.length} broken reference(s); nothing was restored.`);
  });
  return db.export();
}
