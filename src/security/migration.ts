import { CloudClient } from '@/sync/client';
import { decryptSnapshot } from '@/sync/crypto';
import { SecurityClient } from './client';
import { base64, unbase64, encryptObject, decryptObject, type Envelope } from './crypto';
export function snapshotPlaintext(bytes: Uint8Array) {
  if (bytes[0] !== 123) return bytes;
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value.format !== 'pt-database' || typeof value.bytes !== 'string')
    throw new Error('Invalid snapshot payload');
  return unbase64(value.bytes);
}
export async function migrateLegacy(
  client: SecurityClient,
  key: CryptoKey,
  token: string,
  passphrase: string,
  onProgress: (message: string) => void,
) {
  const legacy = new CloudClient({ baseUrl: client.baseUrl, token });
  const status = await client.request<{ count: number; verified: number[] }>(
    '/api/migration/start',
    'POST',
    {},
  );
  for (let revision = 1; revision <= status.count; revision++) {
    onProgress(`Verifying and encrypting version ${revision} of ${status.count}`);
    const original = await legacy.getVersion(revision),
      plain = await decryptSnapshot(original.envelope, passphrase);
    const envelope = await encryptObject(
      key,
      new TextEncoder().encode(
        JSON.stringify({ format: 'pt-database', bytes: base64(plain), label: original.label }),
      ),
      { purpose: 'snapshot', ref: 'treasury', rev: revision, created: original.createdAt },
    );
    await client.request(`/api/migration/versions/${revision}`, 'PUT', { envelope });
    const saved = await client.request<{ envelope: Envelope }>(`/api/migration/versions/${revision}`);
    const verified = snapshotPlaintext(
      await decryptObject(key, saved.envelope, { purpose: 'snapshot', ref: 'treasury', rev: revision }),
    );
    if (verified.length !== plain.length || verified.some((b, i) => b !== plain[i]))
      throw new Error(`Version ${revision} failed read-back verification. Legacy history remains intact.`);
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(saved.envelope))),
    );
    const envelopeDigest = base64(digest).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    await client.request('/api/migration/verify', 'POST', { revision, envelopeDigest });
  }
  onProgress('Every version verified. Committing the encrypted history.');
  await client.request('/api/migration/commit', 'POST', {});
}
