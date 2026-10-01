import { it, expect } from 'vitest';
import { ReviewSyncBackend } from '@/security/reviewSync';
import { MemoryReviewBackend, ReviewStore } from '@/review-store';
import { SecurityError } from '@/security/client';
import { importDataKey, random, decryptObject, type Envelope } from '@/security/crypto';
class Cloud {
  rows = new Map<string, { ref: string; revision: number; header: Envelope; envelope: Envelope }>();
  tombstones = new Set<string>();
  writes = 0;
  offline = false;
  async request<T>(path: string, method = 'GET', value?: unknown, revision?: number): Promise<T> {
    if (this.offline) throw new TypeError('Network unavailable');
    const ref = path.split('/').at(-1)!;
    if (path === '/api/review')
      return {
        reviews: [...this.rows.values()].map(({ ref, revision, header }) => ({ ref, revision, header })),
        tombstones: [...this.tombstones],
      } as T;
    if (this.tombstones.has(ref)) throw new SecurityError(410, 'deleted', 0);
    if (method === 'GET') {
      const row = this.rows.get(ref);
      if (!row) throw new SecurityError(404, 'not_found', 0);
      return { envelope: row.envelope } as T;
    }
    const current = this.rows.get(ref)?.revision ?? 0;
    if (current !== revision) throw new SecurityError(409, 'revision_conflict', 0);
    if (method === 'DELETE') {
      this.rows.delete(ref);
      this.tombstones.add(ref);
      return { ok: true } as T;
    }
    if (this.rows.size >= 3 && !this.rows.has(ref)) throw new SecurityError(409, 'review_limit', 0);
    this.rows.set(ref, {
      ref,
      revision: current + 1,
      ...(value as { header: Envelope; envelope: Envelope }),
    });
    this.writes++;
    return { revision: current + 1 } as T;
  }
}
async function device(cloud: Cloud, key: CryptoKey, local = new MemoryReviewBackend(), offline = false) {
  const backend = new ReviewSyncBackend(local, cloud, key, 'harper', '1', () => undefined, 30000, offline),
    store = new ReviewStore(backend);
  await store.load();
  return { backend, store, local };
}
function update(store: ReviewStore, ref: string, description: string) {
  store.edit(ref, (r) => {
    r.transactions = [
      {
        id: 'tx',
        institutionAccountId: 'a',
        source: { kind: 'file', name: 'fictional.csv' },
        postedDate: `${r.month}-03`,
        amount: '-12.34',
        sourceAmount: '12.3400',
        description,
        pending: false,
        removedAtSource: false,
      },
    ];
  });
}
it('encrypted local edits coalesce into a single cloud write and keep baseline metadata out of plaintext', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    d = await device(cloud, key);
  const r = d.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(d.store, r.ref, 'FIRST CANARY');
  update(d.store, r.ref, 'LATEST CANARY');
  // Local saves finish without waiting for the cloud debounce.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(cloud.writes).toBe(0);
  await d.store.flush();
  expect(cloud.writes).toBe(1);
  expect(d.local.value).not.toContain('CANARY');
  expect(d.backend.status.phase).toBe('synced');
  d.backend.close();
});
it('concurrent edits expose both copies; keep both preserves two separate encrypted reviews', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    first = await device(cloud, key),
    r = first.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(first.store, r.ref, 'original');
  await first.store.flush();
  const second = await device(cloud, key);
  update(first.store, r.ref, 'device one');
  update(second.store, r.ref, 'device two');
  await first.store.flush();
  await expect(second.store.flush()).rejects.toThrow('conflict');
  expect(second.backend.status.conflicts[0]).toMatchObject({
    ref: r.ref,
    deviceCount: 1,
    cloudCount: 1,
    canKeepBoth: true,
  });
  expect(second.store.get(r.ref)?.transactions[0].description).toBe('device two');
  await second.backend.resolve(r.ref, 'both');
  expect(second.store.entries().filter((e) => e.state === 'open')).toHaveLength(2);
  expect(cloud.rows.size).toBe(2);
  const values = [];
  for (const row of cloud.rows.values())
    values.push(
      JSON.parse(
        new TextDecoder().decode(
          await decryptObject(key, row.envelope, { purpose: 'review', ref: row.ref, rev: row.revision }),
        ),
      ).transactions[0].description,
    );
  expect(values.sort()).toEqual(['device one', 'device two']);
  first.backend.close();
  second.backend.close();
});
it('offline editing preserves baselines; reconnecting chooses a conflict instead of silently overwriting', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    local = new MemoryReviewBackend(),
    first = await device(cloud, key, local),
    r = first.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(first.store, r.ref, 'base');
  await first.store.flush();
  first.backend.close();
  const second = await device(cloud, key);
  update(second.store, r.ref, 'cloud changed');
  await second.store.flush();
  const offline = await device(cloud, key, local, true);
  update(offline.store, r.ref, 'offline changed');
  await offline.store.flush();
  expect(local.value).not.toContain('offline changed');
  offline.backend.close();
  const reconnect = await device(cloud, key, local);
  expect(reconnect.backend.status.phase).toBe('conflict');
  expect(reconnect.store.get(r.ref)?.transactions[0].description).toBe('offline changed');
  await reconnect.backend.resolve(r.ref, 'cloud');
  expect(reconnect.store.get(r.ref)?.transactions[0].description).toBe('cloud changed');
  second.backend.close();
  reconnect.backend.close();
});
it('cloud tombstones win over offline edits; clearing deletes the server review before dropping local rows', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    first = await device(cloud, key),
    r = first.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(first.store, r.ref, 'DELETION CANARY');
  await first.store.flush();
  const second = await device(cloud, key);
  update(second.store, r.ref, 'OFFLINE CANARY');
  await first.store.finish(r.ref, 'cleared', async () => undefined);
  expect(cloud.tombstones.has(r.ref)).toBe(true);
  expect(first.store.get(r.ref)).toBeNull();
  await second.store.flush();
  expect(second.store.get(r.ref)).toBeNull();
  expect(second.store.entries()[0].state).toBe('cleared');
  expect(cloud.rows.size).toBe(0);
  first.backend.close();
  second.backend.close();
});
it('failed finalization retains raw rows and retry succeeds after the connection returns', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    first = await device(cloud, key),
    r = first.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(first.store, r.ref, 'RETAIN CANARY');
  await first.store.flush();
  cloud.offline = true;
  await expect(first.store.finish(r.ref, 'cleared', async () => undefined)).rejects.toThrow();
  expect(first.store.get(r.ref)?.transactions[0].description).toBe('RETAIN CANARY');
  expect(first.store.entries()[0].state).toBe('awaiting_upload');
  cloud.offline = false;
  await first.store.finish(r.ref, 'cleared', async () => undefined);
  expect(first.store.get(r.ref)).toBeNull();
  expect(cloud.tombstones.has(r.ref)).toBe(true);
  first.backend.close();
});

it('explicit sync discovers another device update even with no queued local edits', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    first = await device(cloud, key);
  const r = first.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(first.store, r.ref, 'base');
  await first.store.flush();
  const second = await device(cloud, key);
  await second.store.flush();
  update(first.store, r.ref, 'remote update');
  await first.store.flush();
  await second.store.flush();
  expect(second.store.get(r.ref)?.transactions[0].description).toBe('remote update');
  first.backend.close();
  second.backend.close();
});
it('a full cloud review limit reports an error without retrying indefinitely', async () => {
  const cloud = new Cloud(),
    key = await importDataKey(random()),
    d = await device(cloud, key);
  const request = cloud.request.bind(cloud);
  cloud.request = async <T>(path: string, method = 'GET', value?: unknown, revision?: number): Promise<T> => {
    if (method === 'PUT') throw new SecurityError(409, 'review_limit', 0);
    return request<T>(path, method, value, revision);
  };
  const r = d.store.create(new Date().toISOString().slice(0, 7), 'budget');
  update(d.store, r.ref, 'keep local');
  await expect(d.store.flush()).rejects.toMatchObject({ code: 'review_limit' });
  expect(d.store.get(r.ref)?.transactions).toHaveLength(1);
  expect(d.backend.status.phase).toBe('error');
  d.backend.close();
});
