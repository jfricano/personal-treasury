import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Treasury } from '@/api/treasury';
import { defaultStorage, IndexedDbStorage } from '@/db/storage';
import { registerReviewBackend } from '@/features/spending/useReviewStore';
import { SecurityClient } from '@/security/client';
import { base64, derivePasswordKeys, wrapDataKey } from '@/security/crypto';
import { readOfflineAccess, unlockOffline } from '@/security/offline';
import { enterPrivateTreasury } from '@/security/privateEntry';
import { EncryptedStorage } from '@/security/storage';

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  rename: vi.fn<(from: string, to: string) => Promise<void>>(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => fs.files.has(path),
  readTextFile: async (path: string) => fs.files.get(path),
  writeTextFile: async (path: string, text: string) => void fs.files.set(path, text),
  rename: fs.rename,
}));
vi.mock('@/db/storage', async (importOriginal) => {
  const storage = await importOriginal<typeof import('@/db/storage')>();
  const desktop = new storage.MemoryStorage();
  const browser = new storage.MemoryStorage();
  return {
    ...storage,
    defaultStorage: () => desktop,
    IndexedDbStorage: class {
      constructor() {
        return browser;
      }
    },
  };
});
vi.mock('@/security/device', () => ({ readDeviceKey: async () => ({ id: 'fixture-device' }) }));
vi.mock('@/features/spending/useReviewStore', () => ({ registerReviewBackend: vi.fn() }));

const wasmUrl = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const origin = 'https://treasury.example.invalid';
const password = 'a synthetic test password only';
const prelogin = {
  scheme: 'argon2id-hkdf-v1',
  salt: base64(new Uint8Array(32).fill(7)),
  params: { m: 47104, t: 1, p: 1 },
};

async function fixture() {
  const { wrapKey } = await derivePasswordKeys(password, prelogin.salt, prelogin.params);
  const userId = 'fixture-owner';
  const kid = 'fixture-key';
  const wrapped = await wrapDataKey(wrapKey, new Uint8Array(32).fill(5), userId, kid);
  const client = new SecurityClient(origin);
  let revision = 0;
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    switch (new URL(url).pathname) {
      case '/api/migration/status':
        return Response.json({ required: false });
      case '/api/sync/head':
        if (init?.method === 'PUT') revision++;
        return Response.json({ revision });
      case '/fixture/token':
        return Response.json({ present: new Headers(init?.headers).has('Authorization') });
      default:
        throw new Error('Unexpected request in the entry fixture');
    }
  });
  vi.stubGlobal('fetch', request);
  return { client, response: { wrapped, userId, kid, token: 'fixture-session' }, wrapKey };
}

describe('entering an authenticated private treasury', () => {
  beforeEach(async () => {
    fs.files.clear();
    fs.rename.mockReset().mockImplementation(async (from, to) => {
      fs.files.set(to, fs.files.get(from)!);
      fs.files.delete(from);
    });
    for (const storage of [defaultStorage(), new IndexedDbStorage()]) {
      for (const name of await storage.list()) await storage.remove(name);
    }
    vi.mocked(registerReviewBackend).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('accepts the real prelogin response shape and reopens the encrypted local copy offline', async () => {
    const { client, response, wrapKey } = await fixture();
    const result = await enterPrivateTreasury(client, response, wrapKey, prelogin, true, wasmUrl);
    if (result.kind !== 'opened') throw new Error('Expected an opened treasury');
    try {
      const record = await readOfflineAccess(origin);
      expect(record).toEqual(result.offlineAccess);
      expect(JSON.parse(fs.files.get('offline-access.json')!)).not.toHaveProperty('scheme');
      const key = await unlockOffline(record!, password);
      const storage = new EncryptedStorage(defaultStorage(), key, `v3:${response.userId}`);
      expect(await storage.load('default')).toEqual(result.treasury.db.export());
    } finally {
      result.session.close();
    }
  });

  it('drops an unfinished native session after a file failure and preserves a prior offline record', async () => {
    const { client, response, wrapKey } = await fixture();
    const first = await enterPrivateTreasury(client, response, wrapKey, prelogin, true, wasmUrl);
    if (first.kind !== 'opened') throw new Error('Expected an opened treasury');
    first.session.close();
    const previousRecord = fs.files.get('offline-access.json');
    vi.mocked(registerReviewBackend).mockClear();

    const subscribe = Treasury.prototype.subscribe;
    const unsubscribe = vi.fn();
    vi.spyOn(Treasury.prototype, 'subscribe').mockImplementation(function (this: Treasury, listener) {
      const stop = subscribe.call(this, listener);
      return () => {
        stop();
        unsubscribe();
      };
    });
    const error = new Error('Synthetic offline record write failure');
    fs.rename.mockRejectedValueOnce(error);
    await expect(enterPrivateTreasury(client, response, wrapKey, prelogin, true, wasmUrl)).rejects.toBe(
      error,
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(registerReviewBackend).not.toHaveBeenCalled();
    expect(fs.files.get('offline-access.json')).toBe(previousRecord);
    await expect(client.request('/fixture/token')).resolves.toEqual({ present: false });

    const retry = await enterPrivateTreasury(client, response, wrapKey, prelogin, true, wasmUrl);
    if (retry.kind !== 'opened') throw new Error('Expected a fresh entry to succeed');
    retry.session.close();
  });

  it('does not write a native offline file on the website', async () => {
    const { client, response, wrapKey } = await fixture();
    const result = await enterPrivateTreasury(
      client,
      { ...response, token: undefined },
      wrapKey,
      prelogin,
      false,
      wasmUrl,
    );
    if (result.kind !== 'opened') throw new Error('Expected an opened treasury');
    try {
      expect(result.offlineAccess).toBeNull();
      expect(fs.files.size).toBe(0);
    } finally {
      result.session.close();
    }
  });
});
