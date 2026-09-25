import type { DatabaseStorage } from '@/db/storage';

const PREFIX = 'pt.demo.db.';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Demo storage: the database lives in this browser tab's sessionStorage, so it
 * survives a reload and disappears when the tab closes. Nothing leaves the
 * browser. Safety copies stay in memory to keep within the storage quota, and
 * if the database outgrows the quota it falls back to memory for the session.
 */
export class SessionDatabaseStorage implements DatabaseStorage {
  readonly kind = 'session' as const;
  private memory = new Map<string, Uint8Array>();
  /** True once a save could not reach sessionStorage; changes then last only until reload. */
  memoryOnly = false;

  private store(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  private persistent(name: string) {
    return !name.includes('~') && !this.memoryOnly && this.store() !== null;
  }

  async load(name: string) {
    const mem = this.memory.get(name);
    if (mem) return new Uint8Array(mem);
    try {
      const text = this.store()?.getItem(PREFIX + name);
      return text ? fromBase64(text) : null;
    } catch {
      return null;
    }
  }

  async save(name: string, bytes: Uint8Array) {
    if (this.persistent(name)) {
      try {
        this.store()!.setItem(PREFIX + name, toBase64(bytes));
        this.memory.delete(name);
        return;
      } catch {
        this.memoryOnly = true;
        try {
          this.store()?.removeItem(PREFIX + name);
        } catch {
          /* the memory copy below is authoritative from here on */
        }
      }
    }
    this.memory.set(name, new Uint8Array(bytes));
  }

  async list() {
    const names = new Set(this.memory.keys());
    try {
      const s = this.store();
      for (let i = 0; s && i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(PREFIX)) names.add(k.slice(PREFIX.length));
      }
    } catch {
      /* memory entries only */
    }
    return [...names].sort();
  }

  async remove(name: string) {
    this.memory.delete(name);
    try {
      this.store()?.removeItem(PREFIX + name);
    } catch {
      /* nothing stored */
    }
  }
}
