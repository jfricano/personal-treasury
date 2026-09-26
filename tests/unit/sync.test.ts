import { describe, expect, it, vi } from 'vitest';
import {
  CloudClient,
  CloudSyncError,
  decryptSnapshot,
  encryptSnapshot,
  SnapshotCryptoError,
  SyncConflictError,
} from '../../src/sync';

describe('encrypted cloud snapshots', () => {
  it('round trips binary SQLite bytes and produces distinct ciphertext each time', async () => {
    const bytes = Uint8Array.from({ length: 4096 }, (_, index) => index % 256);
    const first = await encryptSnapshot(bytes, 'a long private passphrase');
    const second = await encryptSnapshot(bytes, 'a long private passphrase');
    expect(first).toMatchObject({ format: 'personal-treasury-snapshot', version: 1 });
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(await decryptSnapshot(first, 'a long private passphrase')).toEqual(bytes);
  });

  it('rejects a wrong passphrase, tampering, and unsupported envelope versions', async () => {
    const envelope = await encryptSnapshot(new TextEncoder().encode('SQLite format 3\0data'), 'correct');
    await expect(decryptSnapshot(envelope, 'wrong')).rejects.toBeInstanceOf(SnapshotCryptoError);
    const changed = {
      ...envelope,
      ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`,
    };
    await expect(decryptSnapshot(changed, 'correct')).rejects.toBeInstanceOf(SnapshotCryptoError);
    await expect(
      decryptSnapshot({ ...envelope, version: 2 } as unknown as typeof envelope, 'correct'),
    ).rejects.toBeInstanceOf(SnapshotCryptoError);
  });
});

describe('cloud revision transport', () => {
  it('uses same-origin paths and a quoted expected revision for guarded uploads', async () => {
    const envelope = await encryptSnapshot(new Uint8Array([1]), 'passphrase');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ revision: 1, createdAt: '2026-09-26T00:00:00Z', label: 'Mac' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new CloudClient({ token: 'secret-token', fetchImpl });
    expect(await client.put(envelope, 0, 'Mac')).toMatchObject({ revision: 1 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/sync/head');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'If-Match': '"0"',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual({ envelope, label: 'Mac' });
  });

  it('raises a typed conflict on a stale upload without retrying or overwriting', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 409 }));
    const client = new CloudClient({ token: 'secret-token', fetchImpl });
    const envelope = await encryptSnapshot(new Uint8Array([1]), 'passphrase');
    await expect(client.put(envelope, 4)).rejects.toBeInstanceOf(SyncConflictError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads version history and a selected encrypted version', async () => {
    const envelope = await encryptSnapshot(new Uint8Array([1, 2]), 'passphrase');
    const metadata = { revision: 2, createdAt: '2026-09-26T00:00:00Z', label: 'Phone' };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([metadata])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...metadata, envelope })));
    const client = new CloudClient({ token: 'secret-token', fetchImpl });
    expect(await client.getVersions()).toEqual([metadata]);
    expect(await client.getVersion(2)).toEqual({ ...metadata, envelope });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/api/sync/versions', '/api/sync/versions/2']);
  });

  it('rejects a desktop URL without HTTPS and malformed cloud metadata', async () => {
    expect(() => new CloudClient({ baseUrl: 'http://example.com', token: 'token' })).toThrow(CloudSyncError);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ revision: '1', createdAt: null, label: null })));
    const client = new CloudClient({ baseUrl: 'https://cloud.example.com', token: 'token', fetchImpl });
    await expect(client.getHead()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
