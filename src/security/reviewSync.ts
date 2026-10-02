import type { Review } from '@/domain/spending';
import type { ReviewBackend, ReviewEntry, ReviewState } from '@/review-store';
import { sha256 } from '@/import/statements';
import { encryptObject, decryptObject, type Envelope } from './crypto';
import type { SecurityClient } from './client';
type Baseline = { revision: number; hash: string };
type RemoteRow = { ref: string; revision: number; header: Envelope };
type Listing = { reviews: RemoteRow[]; tombstones: string[] };
export type ConflictChoice = 'device' | 'cloud' | 'both';
export interface ReviewConflict {
  ref: string;
  month: string;
  deviceCount: number;
  cloudCount: number;
  canKeepBoth: boolean;
}
export interface ReviewSyncStatus {
  phase: 'checking' | 'synced' | 'pending' | 'offline' | 'error' | 'conflict';
  message: string;
  conflicts: ReviewConflict[];
}
interface Conflict {
  revision: number;
  entry: ReviewEntry;
  review: Review;
  copyRef?: string;
}
const empty = (): ReviewState => ({ version: 1, index: [], reviews: {} });
const active = (entry: ReviewEntry) => ['open', 'awaiting_upload'].includes(entry.state);
/** An encrypted local save is immediate; cloud writes coalesce for thirty seconds. Baselines stay outside SQLite. */
export class ReviewSyncBackend implements ReviewBackend {
  private state = empty();
  private baselines: Record<string, Baseline> = {};
  private conflicts = new Map<string, Conflict>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private localChain: Promise<void> = Promise.resolve();
  private generation = 0;
  private prepared = 0;
  private dirty = false;
  private closed = false;
  private updates = new Set<(raw: string) => void>();
  status: ReviewSyncStatus = { phase: 'checking', message: 'Checking encrypted reviews', conflicts: [] };
  constructor(
    private local: ReviewBackend,
    private client: Pick<SecurityClient, 'request'>,
    private key: CryptoKey,
    private id: string,
    private kid: string,
    private changed: () => void = () => undefined,
    private debounceMs = 30000,
    private offline = false,
  ) {}
  onUpdate(fn: (raw: string) => void) {
    this.updates.add(fn);
    return () => {
      this.updates.delete(fn);
    };
  }
  private setStatus(phase: ReviewSyncStatus['phase'], message: string) {
    this.status = {
      phase,
      message,
      conflicts: [...this.conflicts].map(([ref, c]) => ({
        ref,
        month: c.entry.month,
        deviceCount: this.state.reviews[ref]?.transactions.length ?? 0,
        cloudCount: c.review.transactions.length,
        canKeepBoth: !!this.state.reviews[ref] && this.state.index.filter(active).length < 3,
      })),
    };
    this.changed();
  }
  private async persist() {
    const raw = JSON.stringify({
      format: 'pt-review-state',
      v: 2,
      state: this.state,
      baselines: this.baselines,
    });
    const key = this.key;
    this.localChain = this.localChain
      .catch(() => undefined)
      .then(async () => {
        const e = await encryptObject(key, new TextEncoder().encode(raw), {
          purpose: 'review-local',
          ref: this.id,
          rev: 1,
          kid: this.kid,
        });
        await this.local.save(JSON.stringify(e));
      });
    await this.localChain;
  }
  private notify() {
    const raw = JSON.stringify(this.state);
    for (const fn of this.updates) fn(raw);
  }
  private schedule(delay = this.debounceMs) {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, delay);
  }
  async load() {
    const raw = await this.local.load();
    if (raw) {
      const e = JSON.parse(raw);
      const value = JSON.parse(
        new TextDecoder().decode(
          await decryptObject(this.key, e, { purpose: 'review-local', ref: this.id, rev: 1 }),
        ),
      );
      if (value.format === 'pt-review-state' && value.v === 2) {
        this.state = value.state;
        this.baselines = value.baselines;
      } else this.state = value;
      if (this.state.version !== 1 || !Array.isArray(this.state.index) || !this.state.reviews)
        throw new Error('Invalid encrypted review storage.');
    }
    this.dirty = true;
    if (this.offline) {
      this.setStatus('offline', 'Reviews saved on this device; sign in online to sync');
      return JSON.stringify(this.state);
    }
    try {
      await this.flush();
    } catch {
      /* The local copy remains available; the status exposes the failure. */
    }
    return JSON.stringify(this.state);
  }
  prepare(raw: string) {
    if (this.closed) throw new Error('The review session ended.');
    this.state = JSON.parse(raw);
    this.generation++;
    this.prepared++;
    this.dirty = true;
  }
  async save(raw: string) {
    if (this.closed) throw new Error('The review session ended.');
    if (!this.prepared) this.prepare(raw);
    this.prepared--;
    await this.persist();
    this.dirty = true;
    if (this.offline) {
      this.setStatus('offline', 'Review saved on this device; sign in online to sync');
      return;
    }
    this.setStatus(
      this.conflicts.size ? 'conflict' : 'pending',
      this.conflicts.size
        ? 'Choose which review copy to keep.'
        : 'Saved on this device; review upload pending',
    );
    this.schedule();
  }
  async flush(): Promise<void> {
    if (this.offline) {
      await this.localChain;
      return;
    }
    if (this.closed) throw new Error('The review session ended.');
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      await this.running;
      if (this.dirty && !this.conflicts.size) return this.flush();
      return;
    }
    this.dirty = true;
    this.running = Promise.resolve().then(async () => {
      try {
        let attempts = 0;
        while (this.dirty) {
          if (++attempts > 8) throw new Error('Review changed repeatedly; sync again after edits settle.');
          this.dirty = false;
          await this.cycle();
        }
        if (this.conflicts.size) {
          this.setStatus('conflict', 'Choose which review copy to keep.');
          throw new Error('Resolve the review conflict before completing this review.');
        }
        this.setStatus('synced', 'Reviews up to date');
      } catch (e) {
        this.dirty = true;
        if (!this.conflicts.size)
          this.setStatus(e instanceof TypeError ? 'offline' : 'error', (e as Error).message);
        if (
          !this.closed &&
          !this.conflicts.size &&
          (e instanceof TypeError || (e as { status?: number }).status === 429)
        )
          this.schedule(
            Math.max(
              this.debounceMs,
              Math.min(900000, ((e as { retryAfter?: number }).retryAfter ?? 0) * 1000),
            ),
          );
        throw e;
      } finally {
        this.running = null;
      }
    });
    await this.running;
  }
  private async hash(entry: ReviewEntry, review: Review) {
    return sha256(new TextEncoder().encode(JSON.stringify({ entry, review })));
  }
  private async cloud(row: RemoteRow) {
    const response = await this.client.request<{ envelope: Envelope }>(`/api/review/${row.ref}`);
    const baseline = this.baselines[row.ref];
    if (row.revision < (baseline?.revision ?? 0)) throw new Error('Review rollback detected.');
    const review = JSON.parse(
      new TextDecoder().decode(
        await decryptObject(this.key, response.envelope, {
          purpose: 'review',
          ref: row.ref,
          rev: row.revision,
        }),
      ),
    ) as Review;
    const entry = JSON.parse(
      new TextDecoder().decode(
        await decryptObject(this.key, row.header, {
          purpose: 'review-header',
          ref: row.ref,
          rev: row.revision,
        }),
      ),
    ) as ReviewEntry;
    if (review.ref !== row.ref || entry.ref !== row.ref || review.month !== entry.month || !active(entry))
      throw new Error('Encrypted review identity mismatch.');
    return { review, entry, revision: row.revision };
  }
  private async cycle() {
    const listing = await this.client.request<Listing>('/api/review');
    for (const ref of listing.tombstones) {
      const entry = this.state.index.find((e) => e.ref === ref);
      if (entry && active(entry)) {
        entry.state = 'cleared';
        delete this.state.reviews[ref];
        this.generation++;
        this.notify();
      }
      delete this.baselines[ref];
      this.conflicts.delete(ref);
    }
    await this.persist();
    const remote = new Map(listing.reviews.map((r) => [r.ref, r]));
    for (const ref of new Set([...remote.keys(), ...this.state.index.map((e) => e.ref)])) {
      if (this.closed) return;
      const entry = this.state.index.find((e) => e.ref === ref),
        review = this.state.reviews[ref],
        row = remote.get(ref),
        baseline = this.baselines[ref],
        generation = this.generation;
      if (listing.tombstones.includes(ref)) continue;
      if (!row) {
        if (entry && active(entry) && review) {
          if (baseline) throw new Error('A previously synced review disappeared without a deletion marker.');
          await this.upload(entry, review, 0);
        }
        continue;
      }
      const value = await this.cloud(row);
      if (generation !== this.generation) {
        this.dirty = true;
        continue;
      }
      const cloudHash = await this.hash(value.entry, value.review),
        localHash = entry && review ? await this.hash(entry, review) : null;
      if (generation !== this.generation) {
        this.dirty = true;
        continue;
      }
      if (!entry) {
        if (this.state.index.filter(active).length >= 3)
          throw new Error('Three local reviews are already open. Discard one before downloading another.');
        this.state.index.push(value.entry);
        this.state.reviews[ref] = value.review;
        this.baselines[ref] = { revision: row.revision, hash: cloudHash };
        this.generation++;
        this.notify();
        await this.persist();
        continue;
      }
      if (!active(entry)) {
        if (baseline && row.revision === baseline.revision) {
          await this.client.request(`/api/review/${ref}`, 'DELETE', {}, row.revision);
          delete this.baselines[ref];
          await this.persist();
        } else this.conflicts.set(ref, value);
        continue;
      }
      if (localHash === cloudHash) {
        this.baselines[ref] = { revision: row.revision, hash: cloudHash };
        this.conflicts.delete(ref);
        await this.persist();
        continue;
      }
      if (baseline && localHash === baseline.hash) {
        this.state.index = this.state.index.filter((e) => e.ref !== ref).concat(value.entry);
        this.state.reviews[ref] = value.review;
        this.baselines[ref] = { revision: row.revision, hash: cloudHash };
        this.conflicts.delete(ref);
        this.generation++;
        this.notify();
        await this.persist();
        continue;
      }
      if (baseline && cloudHash === baseline.hash && row.revision === baseline.revision && review) {
        await this.upload(entry, review, row.revision);
        continue;
      }
      this.conflicts.set(ref, value);
    }
  }
  private async upload(entry: ReviewEntry, review: Review, revision: number) {
    const digest = await this.hash(entry, review),
      envelope = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(review)), {
        purpose: 'review',
        ref: entry.ref,
        rev: revision + 1,
        kid: this.kid,
      }),
      header = await encryptObject(this.key, new TextEncoder().encode(JSON.stringify(entry)), {
        purpose: 'review-header',
        ref: entry.ref,
        rev: revision + 1,
        kid: this.kid,
      });
    try {
      await this.client.request(`/api/review/${entry.ref}`, 'PUT', { envelope, header }, revision);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'conflict' || code === 'revision_conflict') {
        this.dirty = true;
        return;
      }
      if ((e as { status?: number }).status === 410) {
        this.dirty = true;
        return;
      }
      throw e;
    }
    this.baselines[entry.ref] = { revision: revision + 1, hash: digest };
    await this.persist();
    const current = this.state.index.find((e) => e.ref === entry.ref);
    if (
      current &&
      this.state.reviews[entry.ref] &&
      (await this.hash(current, this.state.reviews[entry.ref])) !== digest
    )
      this.dirty = true;
  }
  async finalize(ref: string) {
    await this.flush();
    if (this.offline) return;
    const baseline = this.baselines[ref];
    if (!baseline) return;
    try {
      await this.client.request(`/api/review/${ref}`, 'DELETE', {}, baseline.revision);
    } catch (e) {
      if ((e as { status?: number }).status !== 410) {
        this.dirty = true;
        await this.flush();
        throw new Error('Review changed before deletion. Resolve the copies before completing it.', {
          cause: e,
        });
      }
    }
    delete this.baselines[ref];
    this.conflicts.delete(ref);
    await this.persist();
  }
  async resolve(ref: string, choice: ConflictChoice) {
    const conflict = this.conflicts.get(ref);
    if (!conflict) throw new Error('The conflict no longer exists.');
    const listing = await this.client.request<Listing>('/api/review');
    if (listing.tombstones.includes(ref)) {
      this.dirty = true;
      await this.flush();
      return;
    }
    const row = listing.reviews.find((r) => r.ref === ref);
    if (!row) throw new Error('The cloud review disappeared.');
    if (row.revision !== conflict.revision) {
      this.conflicts.set(ref, await this.cloud(row));
      this.setStatus('conflict', 'The cloud review changed again. Review both copies before choosing.');
      throw new Error(this.status.message);
    }
    const entry = this.state.index.find((e) => e.ref === ref),
      review = this.state.reviews[ref];
    if (choice === 'device') {
      if (entry && review && active(entry)) {
        await this.upload(entry, review, row.revision);
        if (this.baselines[ref]?.revision !== row.revision + 1)
          throw new Error('Cloud changed again. Try resolving the conflict again.');
      } else await this.client.request(`/api/review/${ref}`, 'DELETE', {}, row.revision);
    } else {
      if (choice === 'both') {
        if (!entry || !review || this.state.index.filter(active).length >= 3)
          throw new Error('Keep both requires a local copy and a free review slot.');
        const copyRef = (conflict.copyRef ??= crypto.randomUUID()),
          time = new Date().toISOString(),
          expiresAt = new Date(
            Math.min(Date.parse(time) + 14 * 86400000, Date.parse(review.createdAt) + 45 * 86400000),
          ).toISOString();
        if (Date.parse(expiresAt) <= Date.now()) throw new Error('This review has expired.');
        const copyEntry = { ...entry, ref: copyRef, updatedAt: time, expiresAt },
          copyReview = { ...review, ref: copyRef, updatedAt: time };
        await this.upload(copyEntry, copyReview, 0);
        if (!this.baselines[copyRef]) throw new Error('The copy could not be saved. Try again.');
        this.state.index.push(copyEntry);
        this.state.reviews[copyRef] = copyReview;
      }
      this.state.index = this.state.index.filter((e) => e.ref !== ref).concat(conflict.entry);
      this.state.reviews[ref] = conflict.review;
      this.baselines[ref] = {
        revision: row.revision,
        hash: await this.hash(conflict.entry, conflict.review),
      };
    }
    this.conflicts.delete(ref);
    this.generation++;
    await this.persist();
    this.notify();
    this.dirty = true;
    await this.flush();
  }
  close() {
    if (this.closed) return;
    if (this.dirty || this.prepared) void this.persist().catch(() => undefined);
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.conflicts.clear();
    this.updates.clear();
    this.state = empty();
    this.baselines = {};
    this.key = null as unknown as CryptoKey;
  }
}
