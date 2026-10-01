import { VaultOutbox } from './vaultOutbox';
import { ReviewSyncBackend, type ReviewSyncStatus, type ConflictChoice } from './reviewSync';
import { writeOfflineAccess } from './offline';
import { snapshotPlaintext } from './migration';
import type { Treasury } from '@/api/treasury';
import { IndexedDbStorage, isTauri } from '@/db/storage';
import { localReviewBackend } from '@/review-store/local';
import type { ReviewBackend } from '@/review-store';
import { sha256 } from '@/import/statements';
import {
  decryptObject,
  encryptObject,
  derivePasswordKeys,
  validatePassword,
  DEFAULT_KDF,
  base64,
  unbase64,
  random,
  open,
  wrapDataKey,
  type Sealed,
  type KdfParameters,
  type Envelope,
} from './crypto';
import { readDeviceKey } from './device';
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
  private invalidation = new Set<(reason: string) => void>();
  onInvalidated(fn: (reason: string) => void) {
    this.invalidation.add(fn);
    return () => {
      this.invalidation.delete(fn);
    };
  }
  clearToken() {
    this.token = undefined;
  }
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
    if (response.status === 401 && ['expired', 'locked', 'device_revoked'].includes(body.error)) {
      if (body.error !== 'locked') this.clearToken();
      for (const listener of this.invalidation) listener(body.error);
    }
    if (!response.ok)
      throw new SecurityError(
        response.status,
        body.error ?? 'request_failed',
        Number(response.headers.get('Retry-After') ?? 0),
      );
    if (path === '/api/auth/step-up' && typeof body.token === 'string') this.setToken(body.token);
    return body as T;
  }
}
interface SyncState {
  revision: number;
  hash: string;
}
export class V3Session {
  private reviewSync: ReviewSyncBackend | undefined;
  private idleReviewStatus: ReviewSyncStatus = {
    phase: 'checking',
    message: 'Reviews not opened yet',
    conflicts: [],
  };
  getReviewStatus = () => this.reviewSync?.status ?? this.idleReviewStatus;
  async resolveReviewConflict(ref: string, choice: ConflictChoice) {
    if (!this.reviewSync) throw new Error('Open Budget Analysis first.');
    await this.reviewSync.resolve(ref, choice);
  }
  async flushReviews() {
    await this.reviewSync?.flush();
  }
  private treasury: Treasury | null = null;
  private base: SyncState | null = null;
  private highest = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stop: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private closed = false;
  private listeners = new Set<() => void>();
  private lastUpload = 0;
  private vaultQueue: Promise<void> = Promise.resolve();
  private vaultOperation<T>(task: () => Promise<T>): Promise<T> {
    const next = this.vaultQueue.then(() => {
      if (this.closed) throw new Error('Sign in again to use the provider vault.');
      return task();
    });
    this.vaultQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  status = { phase: 'checking', revision: 0, message: 'Checking encrypted history' };
  constructor(
    readonly client: SecurityClient,
    private key: CryptoKey,
    readonly id: string,
    readonly kid: string,
    readonly offline = false,
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
    if (this.offline) {
      this.statusChanged('offline', 'Unlocked offline. Sign in online to sync.');
      return;
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
    if (this.offline) throw new Error('Sign in online before syncing.');
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
    this.reviewSync?.close();
    this.listeners.clear();
    this.treasury = null;
    this.key = null as unknown as CryptoKey;
  }
  async stepUpDesktop(password: string) {
    if (this.offline) throw new Error('Sign in online for sensitive changes.');
    if (!isTauri()) throw new Error('Use the desktop app for device verification.');
    const device = await readDeviceKey(this.client.baseUrl);
    if (!device) throw new Error('Sign in again to register this device.');
    const pre = await this.client.request<{ salt: string; params: KdfParameters }>(
      '/api/auth/prelogin',
      'POST',
      { userId: this.id },
    );
    const { authKey } = await derivePasswordKeys(password, pre.salt, pre.params);
    const { challenge } = await this.client.request<{ challenge: string }>(
      '/api/auth/step-up/device',
      'POST',
      { userId: this.id, authKey },
    );
    const signature = base64(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          device.privateKey,
          new Uint8Array(unbase64(challenge)),
        ),
      ),
    );
    await this.client.request('/api/auth/step-up', 'POST', {
      method: 'device',
      deviceId: device.id,
      signature,
    });
  }
  async changePassword(current: string, next: string) {
    if (!isTauri()) throw new Error('Change your password in the desktop app.');
    await validatePassword(next, this.id);
    if (current.normalize('NFKC') === next.normalize('NFKC')) throw new Error('Choose a different password.');
    await this.flush();
    await this.stepUpDesktop(current);
    const pre = await this.client.request<{ salt: string; params: KdfParameters }>(
      '/api/auth/prelogin',
      'POST',
      { userId: this.id },
    );
    const old = await derivePasswordKeys(current, pre.salt, pre.params);
    const value = await this.client.request<{ wrapped: Sealed; kid: string }>(
      '/api/auth/password/key',
      'POST',
      { userId: this.id, authKey: old.authKey },
    );
    const raw = await open(old.wrapKey, value.wrapped, `pt/v3/dek|${this.id}|${value.kid}`);
    try {
      const salt = base64(random()),
        keys = await derivePasswordKeys(next, salt, DEFAULT_KDF),
        wrapped = await wrapDataKey(keys.wrapKey, raw, this.id, value.kid);
      await this.client.request('/api/auth/password', 'POST', {
        userId: this.id,
        currentAuthKey: old.authKey,
        authKey: keys.authKey,
        salt,
        params: DEFAULT_KDF,
        kid: value.kid,
        wrapped,
      });
      try {
        await writeOfflineAccess({
          v: 1,
          origin: this.client.baseUrl,
          userId: this.id,
          kid: value.kid,
          salt,
          params: DEFAULT_KDF,
          wrapped,
        });
      } catch {
        throw new Error(
          'Password changed on the service, but offline access could not be updated. Sign in online again to refresh it.',
        );
      }
    } finally {
      raw.fill(0);
    }
  }
  async readVault(): Promise<{ revision: number; vault: import('@/sources/plaid').ProviderVault }> {
    if (this.offline) throw new Error('Sign in online to use provider connections.');
    return this.vaultOperation(() =>
      new VaultOutbox(
        this.baselineStorage,
        this.client,
        this.key,
        `${this.client.baseUrl}:${this.id}`,
        this.kid,
      ).read(),
    );
  }
  async writeVault(vault: import('@/sources/plaid').ProviderVault, revision: number) {
    if (this.offline) throw new Error('Sign in online to use provider connections.');
    await this.vaultOperation(() =>
      new VaultOutbox(
        this.baselineStorage,
        this.client,
        this.key,
        `${this.client.baseUrl}:${this.id}`,
        this.kid,
      ).write(vault, revision),
    );
  }
  reviewBackend(profile: string): ReviewBackend {
    const local = localReviewBackend(`v3:${this.id}:${profile}`, isTauri() ? 'tauri' : 'indexeddb');
    this.reviewSync = new ReviewSyncBackend(
      local,
      this.client,
      this.key,
      this.id,
      this.kid,
      () => this.listeners.forEach((fn) => fn()),
      30000,
      this.offline,
    );
    return this.reviewSync;
  }
}
