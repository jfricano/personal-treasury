import { z } from '@/security/schema';
import { derivePasswordKeys, unwrapDataKey, validateKdf, type KdfParameters, type Sealed } from './crypto';
const Schema = z
  .object({
    v: z.literal(1),
    origin: z.string(),
    userId: z.string().min(3).max(64),
    kid: z.string().min(1).max(64),
    salt: z.string().max(64),
    params: z.object({ m: z.number().int(), t: z.number().int(), p: z.number().int() }),
    wrapped: z.object({ iv: z.string().max(64), ciphertext: z.string().max(256) }),
  })
  .strict();
export interface OfflineAccess {
  v: 1;
  origin: string;
  userId: string;
  kid: string;
  salt: string;
  params: KdfParameters;
  wrapped: Sealed;
}
export function readOfflineRecord(text: string, origin: string): OfflineAccess {
  if (text.length > 16384) throw new Error('Offline sign-in record is too large.');
  const record = Schema.parse(JSON.parse(text));
  if (record.origin !== origin) throw new Error('Offline access belongs to another service.');
  validateKdf(record.params);
  return record;
}
export async function unlockOffline(record: OfflineAccess, password: string) {
  const { wrapKey } = await derivePasswordKeys(password, record.salt, record.params);
  return unwrapDataKey(wrapKey, record.wrapped, record.userId, record.kid);
}
export async function readOfflineAccess(origin: string): Promise<OfflineAccess | null> {
  const fs = await import('@tauri-apps/plugin-fs');
  const options = { baseDir: fs.BaseDirectory.AppData };
  if (!(await fs.exists('offline-access.json', options))) return null;
  return readOfflineRecord(await fs.readTextFile('offline-access.json', options), origin);
}
export async function writeOfflineAccess(record: OfflineAccess) {
  readOfflineRecord(JSON.stringify(record), record.origin);
  const fs = await import('@tauri-apps/plugin-fs');
  const options = { baseDir: fs.BaseDirectory.AppData };
  await fs.writeTextFile('offline-access.json.tmp', JSON.stringify(record), options);
  await fs.rename('offline-access.json.tmp', 'offline-access.json', {
    oldPathBaseDir: fs.BaseDirectory.AppData,
    newPathBaseDir: fs.BaseDirectory.AppData,
  });
}
