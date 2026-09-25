import { Treasury } from '@/api/treasury';
import type { AppExtras } from '@/app/context';
import { loadSqlJs } from '@/db/driver';
import { MemoryStorage } from '@/db/storage';
import { exportWorkbook } from '@/export/workbook';
import { buildBlankDatabase, buildSampleDatabase } from './seed';
import { SessionDatabaseStorage } from './sessionStorage';
import { DemoBanner } from './DemoBanner';

const PROFILE = 'demo';

/**
 * Open the public demo: the sample household on first visit, or whatever this
 * tab already holds after a reload. Nothing the visitor enters is sent anywhere.
 */
export async function openDemo(wasmUrl: string): Promise<{ treasury: Treasury; extras: AppExtras }> {
  const SQL = await loadSqlJs(() => wasmUrl);
  const storage = new SessionDatabaseStorage();
  let sample: Promise<Uint8Array> | null = null;
  const sampleBytes = () => (sample ??= buildSampleDatabase(SQL));
  if (!(await storage.load(PROFILE))) await storage.save(PROFILE, await sampleBytes());
  const treasury = await Treasury.open({ SQL, storage, profile: PROFILE });
  return {
    treasury,
    extras: {
      banner: (
        <DemoBanner storage={storage} sampleBytes={sampleBytes} blankBytes={() => buildBlankDatabase(SQL)} />
      ),
      sampleWorkbook: {
        fileName: 'Harper household workbook.xlsx',
        // Always the original sample, whatever this tab has changed since.
        build: async () => {
          const storage = new MemoryStorage();
          await storage.save('sample', await sampleBytes());
          return exportWorkbook(await Treasury.open({ SQL, storage, profile: 'sample' }));
        },
      },
    },
  };
}
