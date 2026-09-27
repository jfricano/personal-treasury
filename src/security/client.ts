import { snapshotPlaintext } from './migration';
import type { Treasury } from '@/api/treasury';
import { IndexedDbStorage, isTauri } from '@/db/storage';
import { localReviewBackend } from '@/review-store/local';
import type { ReviewBackend } from '@/review-store';
import { sha256 } from '@/import/statements';
import { decryptObject, encryptObject, type Envelope } from './crypto';
export class SecurityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter: number,
  ) {
    super(code.replaceAll('_', ' '));
  }
}
export class SecurityClient {
  constructor(
    readonly baseUrl = '',
    private token?: string,
  ) {
    if (baseUrl) {
      const url = new URL(baseUrl);
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
        throw new Error('Use HTTPS for the private service.');
    }
  }
  setToken(token: string) {
    this.token = token;
  }
  async request<T>(path: string, method = 'GET', value?: unknown, revision?: number): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-PT-Request': '1',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new SecurityError(
        response.status,
        body.error ?? 'request_failed',
        Number(response.headers.get('Retry-After') ?? 0),
      );
    return body as T;
  }
}
interface SyncState {
  revision: number;
  hash: string;
}
export class V3Session {
  private treasury: Treasury | null = null;
  private base: SyncState | null = null;
  private highest = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stop: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private closed = false;
  private listeners = new Set<() => void>();
  private lastUpload = 0;
  status = { phase: 'checking', revision: 0, message: 'Checking encrypted history' };
  constructor(
    readonly client: SecurityClient,
    private key: CryptoKey,
    readonly id: string,
    readonly kid: string,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getStatus = () => this.status;
  private statusChanged(phase: string, message: string) {
    this.status = { phase, message, revision: this.base?.revision ?? 0 };
    this.listeners.forEach((fn) => fn());
  }
  private baselineStorage = new IndexedDbStorage();
  private async saveBaseline() {
    if (!this.base) return;
    const envelope = await encryptObject(
      this.key,
      new TextEncoder().encode(JSON.stringify({ ...this.base, highest: this.highest })),
      { purpose: 'baseline', ref: this.id, rev: 1, kid: this.kid },
    );
    await this.baselineStorage.save(
      `v3-baseline:${this.id}`,
      new TextEncoder().encode(JSON.stringify(envelope)),
    );
  }
  async start(t: Treasury) {
    this.treasury = t;
    const saved = await this.baselineStorage.load(`v3-baseline:${this.id}`);
    if (saved) {
      const e = JSON.parse(new TextDecoder().decode(saved));
      const b = JSON.parse(
        new TextDecoder().decode(
          await decryptObject(this.key, e, { purpose: 'baseline', ref: this.id, rev: 1 }),
        ),
      );
      this.base = { revision: b.revision, hash: b.hash };
      this.highest = b.highest;
    }
    await this.sync();
    this.stop = t.subscribe(() => {
      if (this.closed || this.status.phase === 'conflict' || this.timer) return;
      this.timer = setTimeout(
        () => {
          this.timer = null;
          void this.sync();
        },
        Math.max(1000, 60000 - (Date.now() - this.lastUpload)),
      );
    });
  }
  async sync() {
    if (this.running) return this.running;
    if (this.closed) return;
    this.running = this.reconcile()
      .catch((e) => {
        this.statusChanged(
          e instanceof SecurityError && e.status === 409 ? 'conflict' : 'error',
          (e as Error).message,
        );
        if (e instanceof SecurityError && e.status === 429 && !this.closed) {
          this.timer = setTimeout(
            () => {
              this.timer = null;
              void this.sync();
            },
            Math.max(60000, e.retryAfter * 1000),
          );
        }
      })
      .finally(() => {
        this.running = null;
      });
    await this.running;
  }
  async flush() {
    await this.sync();
    if (this.status.phase !== 'synced') throw new Error(this.status.message);
  }
  private async reconcile() {
    const t = this.treasury!;
    await t.flush();
    const bytes = t.db.export(),
      local = await sha256(bytes),
      head = await this.client.request<{ revision: number }>('/api/sync/head');
    if (head.revision < this.highest)
      throw new Error('Cloud rollback detected. History is older than this device verified.');
    if (!this.base && head.revision === 0) {
      await this.upload(bytes, 0);
      return;
    }
    if (this.base && head.revision === this.base.revision) {
      if (local !== this.base.hash) await this.upload(bytes, head.revision);
      else this.statusChanged('synced', 'Up to date');
      return;
    }
    if ((!this.base && t.isEmpty()) || (this.base && local === this.base.hash)) {
      await this.download(head.revision, bytes, false);
      return;
    }
    this.statusChanged('conflict', 'This device and the cloud changed. Choose which copy to keep.');
  }
  private async upload(bytes: Uint8Array, revision: number) {
    const e = await encryptObject(this.key, bytes, {
      purpose: 'snapshot',
      ref: 'treasury',
      rev: revision + 1,
      kid: this.kid,
    });
    await this.client.request('/api/sync/head', 'PUT', { envelope: e }, revision);
    this.lastUpload = Date.now();
    this.base = { revision: revision + 1, hash: await sha256(bytes) };
    this.highest = Math.max(this.highest, revision + 1);
    await this.saveBaseline();
    this.statusChanged('synced', 'Up to date');
  }
  private async download(revision: number, prior: Uint8Array, safety: boolean, restoring = false) {
    const version = await this.client.request<{ envelope: Envelope }>(`/api/sync/versions/${revision}`);
    const value = await decryptObject(this.key, version.envelope, {
      purpose: 'snapshot',
      ref: 'treasury',
      rev: revision,
      highest: restoring ? 0 : this.highest,
    });
    await this.treasury!.adoptCloudSnapshot(snapshotPlaintext(value), safety, prior);
    this.base = { revision, hash: await sha256(this.treasury!.db.export()) };
    this.highest = Math.max(this.highest, revision);
    await this.saveBaseline();
    this.statusChanged('synced', 'Up to date');
  }
  async useCloud() {
    const head = await this.client.request<{ revision: number }>('/api/sync/head');
    await this.download(head.revision, this.treasury!.db.export(), true);
  }
  async keepLocal() {
    const head = await this.client.request<{ revision: number }>('/api/sync/head');
    if (head.revision < this.highest) throw new Error('Cloud rollback detected.');
    await this.upload(this.treasury!.db.export(), head.revision);
  }
  async restoreVersion(revision: number) {
    await this.flush();
    const head = await this.client.request<{ revision: number }>('/api/sync/head');
    if (head.revision !== this.base?.revision) throw new Error('Cloud changed. Sync before restoring.');
    const original = this.treasury!.db.export();
    const version = await this.client.request<{ envelope: Envelope }>(`/api/sync/versions/${revision}`);
    const value = await decryptObject(this.key, version.envelope, {
      purpose: 'snapshot',
      ref: 'treasury',
      rev: revision,
    });
    await this.upload(snapshotPlaintext(value), head.revision);
    await this.treasury!.adoptCloudSnapshot(snapshotPlaintext(value), true, original);
    this.base!.hash = await sha256(this.treasury!.db.export());
    await this.saveBaseline();
  }
  close() {
    this.closed = true;
    this.stop?.();
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
    this.treasury = null;
  }
  async readVault(): Promise<{ revision: number; vault: import('@/sources/plaid').ProviderVault }> {
    const value = await this.client.request<{ revision: number; envelope?: Envelope }>('/api/vault');
    return {
      revision: value.revision,
      vault: value.envelope
        ? JSON.parse(
            new TextDecoder().decode(
              await decryptObject(this.key, value.envelope, {
                purpose: 'vault',
                ref: 'credentials',
                rev: value.revision,
              }),
            ),
          )
        : {},
    };
  }
  async writeVault(vault: import('@/sources/plaid').ProviderVault, revision: number) {
    const envelope = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(vault)), {
      purpose: 'vault',
      ref: 'credentials',
      rev: revision + 1,
      kid: this.kid,
    });
    await this.client.request('/api/vault', 'PUT', { envelope }, revision);
  }
  reviewBackend(profile: string): ReviewBackend {
    const local = localReviewBackend(`v3:${this.id}:${profile}`, isTauri() ? 'tauri' : 'indexeddb'),
      revisions = new Map<string, number>(),
      uploaded = new Map<string, string>();
    type State = {
      version: 1;
      index: {
        ref: string;
        month: string;
        state: string;
        createdAt: string;
        updatedAt: string;
        expiresAt: string;
      }[];
      reviews: Record<string, unknown>;
    };
    const localSave = async (s: State) => {
      const e = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(s)), {
        purpose: 'review-local',
        ref: this.id,
        rev: 1,
        kid: this.kid,
      });
      await local.save(JSON.stringify(e));
    };
    return {
      load: async () => {
        let state: State = { version: 1, index: [], reviews: {} };
        const raw = await local.load();
        if (raw) {
          const e = JSON.parse(raw);
          state = JSON.parse(
            new TextDecoder().decode(
              await decryptObject(this.key, e, { purpose: 'review-local', ref: this.id, rev: 1 }),
            ),
          );
        }
        const remote = await this.client.request<{
          reviews: {
            ref: string;
            revision: number;
            createdAt: string;
            updatedAt: string;
            expiresAt: string;
            header: Envelope;
          }[];
          tombstones: string[];
        }>('/api/review');
        for (const ref of remote.tombstones) {
          delete state.reviews[ref];
          const e = state.index.find((e) => e.ref === ref);
          if (e) e.state = 'cleared';
        }
        for (const r of remote.reviews) {
          const prior = state.index.find((e) => e.ref === r.ref);
          if (prior && ['cleared', 'discarded', 'expired'].includes(prior.state)) {
            await this.client.request(`/api/review/${r.ref}`, 'DELETE', {}, r.revision);
            delete state.reviews[r.ref];
            continue;
          }
          const response = await this.client.request<{ envelope: Envelope }>(`/api/review/${r.ref}`);
          const value = JSON.parse(
            new TextDecoder().decode(
              await decryptObject(this.key, response.envelope, {
                purpose: 'review',
                ref: r.ref,
                rev: r.revision,
              }),
            ),
          );
          if (prior && prior.updatedAt > r.updatedAt && state.reviews[r.ref])
            throw new Error(
              'This review changed on both devices. Keep this browser open and resolve the review conflict before continuing.',
            );
          state.reviews[r.ref] = value;
          const header = JSON.parse(
            new TextDecoder().decode(
              await decryptObject(this.key, r.header, {
                purpose: 'review-header',
                ref: r.ref,
                rev: r.revision,
              }),
            ),
          );
          state.index = state.index.filter((e) => e.ref !== r.ref);
          state.index.push({ ...r, ...header });
          revisions.set(r.ref, r.revision);
          uploaded.set(r.ref, JSON.stringify(value));
        }
        await localSave(state);
        return JSON.stringify(state);
      },
      save: async (raw) => {
        const state = JSON.parse(raw) as State;
        await localSave(state);
        for (const entry of state.index) {
          const revision = revisions.get(entry.ref) ?? 0;
          if (!['open', 'awaiting_upload'].includes(entry.state)) {
            if (revision) {
              await this.client.request(`/api/review/${entry.ref}`, 'DELETE', {}, revision);
              revisions.delete(entry.ref);
              uploaded.delete(entry.ref);
            }
            continue;
          }
          const value = state.reviews[entry.ref];
          if (!value || uploaded.get(entry.ref) === JSON.stringify(value)) continue;
          const remote = await this.client.request<{
            reviews: { ref: string; revision: number }[];
            tombstones: string[];
          }>('/api/review');
          if (remote.tombstones.includes(entry.ref)) {
            delete state.reviews[entry.ref];
            entry.state = 'cleared';
            await localSave(state);
            throw new Error('This review was deleted on another device. Reload to remove its local copy.');
          }
          const next = revision + 1;
          const envelope = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(value)), {
              purpose: 'review',
              ref: entry.ref,
              rev: next,
              kid: this.kid,
            }),
            header = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(entry)), {
              purpose: 'review-header',
              ref: entry.ref,
              rev: next,
              kid: this.kid,
            });
          await this.client.request(`/api/review/${entry.ref}`, 'PUT', { envelope, header }, revision);
          revisions.set(entry.ref, next);
          uploaded.set(entry.ref, JSON.stringify(value));
        }
      },
    };
  }
}
