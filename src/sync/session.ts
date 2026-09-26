import type { Treasury } from '@/api/treasury';
import { CloudClient, CloudSyncError, SyncConflictError, decryptSnapshot, encryptSnapshot } from './index';

export type SyncPhase =
  'checking' | 'synced' | 'uploading' | 'downloading' | 'conflict' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  revision: number;
  message: string;
}

interface Baseline {
  revision: number;
  hash: string;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readBaseline(key: string): Baseline | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'revision' in value &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) > 0 &&
      'hash' in value &&
      typeof value.hash === 'string' &&
      /^[a-f0-9]{64}$/.test(value.hash)
    )
      return value as Baseline;
  } catch {
    // Missing browser storage causes a cautious first-connection choice.
  }
  return null;
}

/** One local profile connected to one encrypted, versioned cloud history. */
export class CloudSyncSession {
  private baseline: Baseline | null;
  private status: SyncStatus = { phase: 'checking', revision: 0, message: 'Checking cloud version…' };
  private listeners = new Set<() => void>();
  private task: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  constructor(
    readonly treasury: Treasury,
    readonly client: CloudClient,
    private readonly passphrase: string,
    endpoint: string,
  ) {
    this.baseline = readBaseline(`pt.sync.v1.${encodeURIComponent(endpoint)}.${treasury.profile}`);
    this.baselineKey = `pt.sync.v1.${encodeURIComponent(endpoint)}.${treasury.profile}`;
  }

  private readonly baselineKey: string;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = (): SyncStatus => this.status;

  private setStatus(phase: SyncPhase, revision: number, message: string) {
    this.status = { phase, revision, message };
    for (const listener of this.listeners) listener();
  }

  private remember(revision: number, hash: string) {
    this.baseline = { revision, hash };
    try {
      localStorage.setItem(this.baselineKey, JSON.stringify(this.baseline));
    } catch {
      // In-memory baseline still protects this session.
    }
  }

  async start(): Promise<void> {
    // Observe edits even while the first cloud request is in flight.
    this.unsubscribe = this.treasury.subscribe(() => this.schedule());
    await this.syncNow();
    if (this.closed) return;
    this.interval = setInterval(() => void this.syncNow(), 30_000);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onWake);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onWake = () => void this.syncNow();
  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };

  private schedule() {
    if (this.closed || this.status.phase === 'conflict') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), 500);
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.unsubscribe?.();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onWake);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear();
  }

  syncNow(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.task) return this.task;
    this.task = this.reconcile()
      .catch((err: unknown) => {
        if (
          err instanceof SyncConflictError ||
          (err instanceof Error && 'code' in err && err.code === 'sync_conflict')
        ) {
          this.setStatus(
            'conflict',
            this.status.revision,
            'The cloud changed on another device. Choose which copy to keep.',
          );
        } else {
          const message = err instanceof Error ? err.message : 'Cloud sync failed.';
          this.setStatus(
            err instanceof CloudSyncError && err.code === 'network' ? 'offline' : 'error',
            this.status.revision,
            message,
          );
        }
      })
      .finally(() => {
        this.task = null;
      });
    return this.task;
  }

  private async reconcile() {
    await this.treasury.flush();
    const bytes = this.treasury.db.export();
    const localHash = await hashBytes(bytes);
    this.setStatus('checking', this.baseline?.revision ?? 0, 'Checking cloud version…');
    const head = await this.client.getHead();
    const base = this.baseline;

    if (base && head.revision === base.revision) {
      if (localHash === base.hash) this.setStatus('synced', head.revision, 'Up to date');
      else await this.upload(bytes, localHash, head.revision);
      return;
    }
    if (base && head.revision > base.revision && localHash === base.hash) {
      await this.download(head.revision, bytes, false);
      return;
    }
    if (!base && head.revision === 0) {
      await this.upload(bytes, localHash, 0);
      return;
    }
    if (!base && head.revision > 0 && this.treasury.isEmpty()) {
      await this.download(head.revision, bytes, false);
      return;
    }
    this.setStatus(
      'conflict',
      head.revision,
      'This device and the cloud have different data. Choose which copy to keep.',
    );
  }

  private async upload(bytes: Uint8Array, hash: string, expectedRevision: number, label?: string) {
    this.setStatus('uploading', expectedRevision, 'Encrypting and uploading snapshot…');
    const envelope = await encryptSnapshot(bytes, this.passphrase);
    const head = await this.client.put(envelope, expectedRevision, label);
    this.remember(head.revision, hash);
    this.setStatus('synced', head.revision, 'Up to date');
    if ((await hashBytes(this.treasury.db.export())) !== hash) this.schedule();
  }

  private async download(revision: number, priorBytes: Uint8Array, saveCurrentCopy: boolean) {
    this.setStatus('downloading', revision, 'Downloading and checking cloud snapshot…');
    const version = await this.client.getVersion(revision);
    const bytes = await decryptSnapshot(version.envelope, this.passphrase);
    if ((await hashBytes(this.treasury.db.export())) !== (await hashBytes(priorBytes))) {
      this.setStatus('conflict', revision, 'This device changed while the cloud snapshot was downloading.');
      return;
    }
    await this.treasury.adoptCloudSnapshot(bytes, saveCurrentCopy, priorBytes);
    this.remember(revision, await hashBytes(this.treasury.db.export()));
    this.setStatus('synced', revision, 'Up to date');
  }

  /** Explicit conflict resolution: the current cloud copy remains in version history. */
  async keepLocal(): Promise<void> {
    if (this.status.phase !== 'conflict') throw new Error('No sync conflict to resolve.');
    const head = await this.client.getHead();
    await this.treasury.flush();
    const bytes = this.treasury.db.export();
    await this.upload(bytes, await hashBytes(bytes), head.revision, 'Kept device copy after conflict');
  }

  /** Explicit conflict resolution: preserve this device's unsynced data as a safety copy. */
  async useCloud(): Promise<void> {
    if (this.status.phase !== 'conflict') throw new Error('No sync conflict to resolve.');
    const head = await this.client.getHead();
    if (head.revision === 0) throw new Error('The cloud has no snapshot to use.');
    await this.treasury.flush();
    await this.download(head.revision, this.treasury.db.export(), true);
  }

  /** Restoring an older version creates a new head; history is never deleted. */
  async restoreVersion(revision: number): Promise<void> {
    const head = await this.client.getHead();
    const version = await this.client.getVersion(revision);
    const bytes = await decryptSnapshot(version.envelope, this.passphrase);
    await this.treasury.flush();
    const priorBytes = this.treasury.db.export();
    const priorHash = await hashBytes(priorBytes);
    if (
      !this.baseline ||
      this.status.phase !== 'synced' ||
      head.revision !== this.baseline.revision ||
      priorHash !== this.baseline.hash
    ) {
      this.setStatus(
        'conflict',
        head.revision,
        'Resolve the current cloud or device changes before restoring a version.',
      );
      return;
    }
    // Upload first with If-Match, then change the local copy only if the cloud accepted it.
    const next = await this.client.put(version.envelope, head.revision, `Restored version ${revision}`);
    try {
      await this.treasury.adoptCloudSnapshot(bytes, true, priorBytes);
    } catch (error) {
      this.setStatus(
        'conflict',
        next.revision,
        'The cloud version was restored, but this device could not adopt it. Choose which copy to keep.',
      );
      throw error;
    }
    this.remember(next.revision, await hashBytes(this.treasury.db.export()));
    this.setStatus('synced', next.revision, `Restored version ${revision}`);
  }
}
