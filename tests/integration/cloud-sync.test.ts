import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudClient, type SnapshotEnvelope } from '@/sync';
import { CloudSyncSession } from '@/sync/session';
import { MemoryStorage } from '@/db/storage';
import { freshTreasury } from './helpers';

function memoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function snapshotApi() {
  const versions: {
    revision: number;
    createdAt: string;
    label: string | null;
    envelope: SnapshotEnvelope;
  }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'https://sync.test').pathname;
    const head = versions.at(-1) ?? { revision: 0, createdAt: null, label: null };
    if (path === '/api/sync/head' && init?.method === 'PUT') {
      if (init.headers && new Headers(init.headers).get('If-Match') !== `"${head.revision}"`)
        return Response.json({ error: 'revision_conflict', head }, { status: 409 });
      const body = JSON.parse(String(init.body)) as { envelope: SnapshotEnvelope; label?: string };
      const next = {
        revision: head.revision + 1,
        createdAt: new Date().toISOString(),
        label: body.label ?? null,
        envelope: body.envelope,
      };
      versions.push(next);
      return Response.json({ revision: next.revision, createdAt: next.createdAt, label: next.label });
    }
    if (path === '/api/sync/head') return Response.json(head);
    if (path === '/api/sync/versions')
      return Response.json(versions.map(({ envelope: _envelope, ...meta }) => meta).reverse());
    const revision = Number(path.split('/').at(-1));
    const found = versions.find((version) => version.revision === revision);
    return found ? Response.json(found) : Response.json({ error: 'not_found' }, { status: 404 });
  }) as typeof fetch;
  return { versions, client: () => new CloudClient({ token: 'sample-token', fetchImpl }) };
}

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('guarded cloud snapshots', () => {
  it('syncs two local databases, stops a divergent overwrite, and restores an older version', async () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryLocalStorage();
    const api = snapshotApi();
    const first = await freshTreasury(undefined, 'device-a');
    first.createAccount({ code: 'A' });
    await first.flush();
    const a = new CloudSyncSession(first, api.client(), 'a long sample passphrase', 'https://sync.test');
    await a.syncNow();
    expect(api.versions).toHaveLength(1);

    const second = await freshTreasury(undefined, 'device-b');
    const b = new CloudSyncSession(second, api.client(), 'a long sample passphrase', 'https://sync.test');
    await b.syncNow();
    expect(second.accounts().map((account) => account.code)).toEqual(['A']);

    first.createAccount({ code: 'B' });
    await a.syncNow();
    second.createAccount({ code: 'C' });
    await b.syncNow();
    expect(b.getStatus().phase).toBe('conflict');
    expect(api.versions).toHaveLength(2);
    expect(second.accounts().map((account) => account.code)).toEqual(['A', 'C']);

    await b.keepLocal();
    expect(api.versions).toHaveLength(3);
    expect(b.getStatus().phase).toBe('synced');
    await b.restoreVersion(2);
    expect(api.versions).toHaveLength(4);
    expect(second.accounts().map((account) => account.code)).toEqual(['A', 'B']);
    expect((await second.safetyCopies()).some((name) => name.includes('before-cloud-pull'))).toBe(true);
    a.close();
    b.close();
  });

  it('does not replace an edit made while a downloaded snapshot is being checked', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowCopyStorage extends MemoryStorage {
      override async save(name: string, bytes: Uint8Array) {
        if (name.includes('~before-cloud-pull')) {
          entered();
          await hold;
        }
        return super.save(name, bytes);
      }
    }
    const treasury = await freshTreasury(new SlowCopyStorage(), 'race');
    const before = treasury.db.export();
    const remote = await freshTreasury(undefined, 'remote');
    remote.createAccount({ code: 'CLOUD' });
    const adoption = treasury.adoptCloudSnapshot(remote.db.export(), true, before);
    await waiting;
    treasury.createAccount({ code: 'LOCAL' });
    release();
    await expect(adoption).rejects.toMatchObject({ code: 'sync_conflict' });
    expect(treasury.accounts().map((account) => account.code)).toEqual(['LOCAL']);
  });

  it('flags a conflict if local adoption fails after a restore reaches the cloud', async () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryLocalStorage();
    const api = snapshotApi();
    const treasury = await freshTreasury(undefined, 'restore-race');
    treasury.createAccount({ code: 'FIRST' });
    const session = new CloudSyncSession(
      treasury,
      api.client(),
      'a long sample passphrase',
      'https://sync.test',
    );
    await session.syncNow();
    treasury.createAccount({ code: 'SECOND' });
    await session.syncNow();
    vi.spyOn(treasury, 'adoptCloudSnapshot').mockRejectedValueOnce(new Error('Local copy changed'));

    await expect(session.restoreVersion(1)).rejects.toThrow('Local copy changed');
    expect(api.versions).toHaveLength(3);
    expect(session.getStatus()).toMatchObject({ phase: 'conflict', revision: 3 });
    expect(treasury.accounts().map((account) => account.code)).toEqual(['FIRST', 'SECOND']);
    session.close();
  });
});
