import { Treasury } from '@/api/treasury';
import { loadSqlJs } from '@/db/driver';
import { MemoryStorage } from '@/db/storage';
import { analyzeWorkbook } from '@/import/analyze';
import { seedHarpers } from '@/demo/seed';

/** Fixed "today" for the sample data, so public tests are deterministic. */
export const SAMPLE_TODAY = new Date(2026, 8, 24); // 2026-09-24, local time

export async function freshTreasury(storage = new MemoryStorage(), profile = 'test') {
  return Treasury.open({ SQL: await loadSqlJs(), storage, profile });
}

export async function importInto(
  t: Treasury,
  bytes: Uint8Array,
  name: string,
  mode: 'empty' | 'replace' = 'empty',
) {
  const plan = await analyzeWorkbook(bytes, name, {
    existingAliases: t.existingAliasesForImport(),
    committedHashes: t.committedHashes(),
  });
  const res = await t.commitImport(plan, mode);
  return { plan, ...res };
}

/** A treasury holding the fictional Harper household (src/demo/persona.ts). */
export async function sampleTreasury(today = SAMPLE_TODAY) {
  const t = await freshTreasury();
  seedHarpers(t, today);
  return t;
}

export function tableCounts(t: Treasury) {
  const tables = [
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
  ];
  return Object.fromEntries(
    tables.map((n) => [n, Number(t.db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${n}`)!.n)]),
  );
}

export function debtControls(t: Treasury) {
  const s = t.debtBoard().summary;
  return { count: s.nonZeroCount, total: s.totalOutstanding, largest: s.largestDebt, netSum: s.netSum };
}
