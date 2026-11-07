import { Treasury } from '@/api/treasury';
import { defaultStorage, IndexedDbStorage } from '@/db/storage';
import { registerReviewBackend } from '@/features/spending/useReviewStore';
import { SecurityClient, V3Session } from './client';
import { base64, unwrapDataKey, type Sealed } from './crypto';
import { readDeviceKey, saveDeviceKey } from './device';
import { writeOfflineAccess, type OfflineAccess } from './offline';
import { EncryptedStorage } from './storage';

export type EntryResponse = { wrapped: Sealed; kid: string; userId: string; token?: string };

/** Enter only after the service has accepted sign-in or an existing session's unlock. */
export async function enterPrivateTreasury(
  client: SecurityClient,
  response: EntryResponse,
  wrapKey: CryptoKey | null,
  parameters: Pick<OfflineAccess, 'salt' | 'params'> | null,
  desktop: boolean,
  wasmUrl: string,
) {
  let session: V3Session | undefined;
  try {
    if (!wrapKey) throw new Error('Enter your password again.');
    if (response.token) client.setToken(response.token);
    const key = await unwrapDataKey(wrapKey, response.wrapped, response.userId, response.kid);
    if (desktop && (await client.request<{ required: boolean }>('/api/migration/status')).required) {
      return { kind: 'migration', key } as const;
    }

    const storage = new EncryptedStorage(
      desktop ? defaultStorage() : new IndexedDbStorage(),
      key,
      `v3:${response.userId}`,
    );
    const treasury = await Treasury.open({ storage, profile: 'default', locateWasm: () => wasmUrl });
    session = new V3Session(client, key, response.userId, response.kid);
    await session.start(treasury);
    if (desktop && !(await readDeviceKey(client.baseUrl))) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
        'sign',
        'verify',
      ]);
      const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
      const { id } = await client.request<{ id: string }>('/api/auth/devices', 'POST', { publicKey });
      await saveDeviceKey(client.baseUrl, { id, privateKey: pair.privateKey, publicKey });
    }

    let offlineAccess: OfflineAccess | null = null;
    if (desktop && parameters) {
      // Prelogin also returns a protocol scheme; the offline file has its own strict schema.
      offlineAccess = {
        v: 1,
        origin: client.baseUrl,
        userId: response.userId,
        kid: response.kid,
        salt: parameters.salt,
        params: parameters.params,
        wrapped: response.wrapped,
      };
      await writeOfflineAccess(offlineAccess);
    }

    registerReviewBackend(treasury, session.reviewBackend(treasury.profile));
    return { kind: 'opened', treasury, session, offlineAccess } as const;
  } catch (error) {
    session?.close();
    // Discard the unfinished native session locally without deleting device or offline data.
    if (desktop) client.clearToken();
    throw error;
  }
}
