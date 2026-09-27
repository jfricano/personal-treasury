import { monthPeriod, type Review } from '@/domain/spending';
export interface ReviewEntry {
  ref: string;
  month: string;
  state: 'open' | 'awaiting_upload' | 'cleared' | 'discarded' | 'expired';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
interface State {
  version: 1;
  index: ReviewEntry[];
  reviews: Record<string, Review>;
}
export interface ReviewBackend {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}
export class MemoryReviewBackend implements ReviewBackend {
  value: string | null = null;
  async load() {
    return this.value;
  }
  async save(v: string) {
    this.value = v;
  }
}
export class ReviewStore {
  private state: State = { version: 1, index: [], reviews: {} };
  private undoHistory = new Map<string, Review[]>();
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  version = 0;
  status: 'saved' | 'saving' | 'error' = 'saved';
  error: string | null = null;
  constructor(
    private backend: ReviewBackend,
    private now = () => new Date(),
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  async load() {
    const value = await this.backend.load();
    if (value) {
      const s = JSON.parse(value) as State;
      if (s.version !== 1 || !Array.isArray(s.index) || !s.reviews)
        throw new Error('Review storage is invalid; recover it before continuing.');
      this.state = s;
    }
    this.expire();
    this.emit();
  }
  entries() {
    this.expire();
    return this.state.index.map((e) => ({ ...e }));
  }
  get(ref: string): Review | null {
    this.expire();
    return this.state.reviews[ref] ? structuredClone(this.state.reviews[ref]) : null;
  }
  private expiry(r: Review) {
    return new Date(
      Math.min(Date.parse(r.updatedAt) + 14 * 86400000, Date.parse(r.createdAt) + 45 * 86400000),
    ).toISOString();
  }
  warning(ref: string) {
    const e = this.state.index.find((x) => x.ref === ref);
    if (!e || e.state !== 'open') return null;
    const idle = this.now().getTime() - Date.parse(e.updatedAt);
    return idle >= 7 * 86400000 || Date.parse(e.expiresAt) - this.now().getTime() <= 3 * 86400000
      ? `This review expires on ${e.expiresAt.slice(0, 10)}. Clear it to keep its report.`
      : null;
  }
  expire() {
    let changed = false;
    for (const e of this.state.index) {
      if (e.state === 'open' && Date.parse(e.expiresAt) <= this.now().getTime()) {
        e.state = 'expired';
        delete this.state.reviews[e.ref];
        this.undoHistory.delete(e.ref);
        changed = true;
      }
    }
    if (changed) this.save();
  }
  create(
    month: string,
    budgetVersionId: string,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  ): Review {
    monthPeriod(month);
    this.expire();
    if (
      this.state.index.some((e) => e.month === month && (e.state === 'open' || e.state === 'awaiting_upload'))
    )
      throw new Error('Resume the existing review for this month');
    if (this.state.index.filter((e) => e.state === 'open' || e.state === 'awaiting_upload').length >= 3)
      throw new Error('Clear or discard an existing review before opening a fourth');
    const time = this.now().toISOString();
    const r: Review = {
      ref: crypto.randomUUID(),
      month,
      budgetVersionId,
      createdAt: time,
      updatedAt: time,
      timeZone,
      settleDays: 3,
      pairingDays: 5,
      transactions: [],
      evidence: {},
      balances: {},
      importedHashes: [],
      note: '',
    };
    this.state.reviews[r.ref] = r;
    this.state.index.push({
      ref: r.ref,
      month,
      state: 'open',
      createdAt: time,
      updatedAt: time,
      expiresAt: this.expiry(r),
    });
    this.save();
    return structuredClone(r);
  }
  edit(ref: string, fn: (r: Review) => void) {
    const current = this.get(ref),
      entry = this.state.index.find((e) => e.ref === ref);
    if (!current || entry?.state !== 'open') throw new Error('This review is no longer open');
    const next = structuredClone(current);
    fn(next);
    next.updatedAt = this.now().toISOString();
    if (JSON.stringify(next).length > 8 * 1024 * 1024) throw new Error('Review exceeds the 8 MiB limit');
    const stack = this.undoHistory.get(ref) ?? [];
    stack.push(current);
    this.undoHistory.set(ref, stack.slice(-100));
    this.state.reviews[ref] = next;
    entry.updatedAt = next.updatedAt;
    entry.expiresAt = this.expiry(next);
    this.save();
  }
  canUndo(ref: string) {
    return !!this.undoHistory.get(ref)?.length;
  }
  undo(ref: string) {
    const entry = this.state.index.find((e) => e.ref === ref);
    if (entry?.state !== 'open') return false;
    const old = this.undoHistory.get(ref)?.pop();
    if (!old) return false;
    old.updatedAt = this.now().toISOString();
    this.state.reviews[ref] = old;
    entry.updatedAt = old.updatedAt;
    entry.expiresAt = this.expiry(old);
    this.save();
    return true;
  }
  async finish(ref: string, state: 'cleared' | 'discarded', beforeDelete?: () => Promise<void>) {
    const entry = this.state.index.find((e) => e.ref === ref);
    if (!entry) throw new Error('Review not found');
    if (state === 'cleared' && beforeDelete) {
      entry.state = 'awaiting_upload';
      this.undoHistory.delete(ref);
      this.save();
      await this.flush();
      await beforeDelete();
    }
    entry.state = state;
    delete this.state.reviews[ref];
    this.undoHistory.delete(ref);
    this.save();
    await this.flush();
  }
  private save() {
    const value = JSON.stringify(this.state);
    this.status = 'saving';
    this.emit();
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.backend.save(value);
          this.status = 'saved';
          this.error = null;
        } catch (e) {
          this.status = 'error';
          this.error = (e as Error).message;
          throw e;
        } finally {
          this.emit();
        }
      });
    void this.chain.catch(() => undefined);
  }
  async flush() {
    await this.chain;
    if (this.status === 'error') throw new Error(this.error ?? 'Review save failed');
  }
}
