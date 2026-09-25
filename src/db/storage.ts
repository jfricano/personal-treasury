/**
 * Where database files live. Each "profile" is a separate SQLite database file.
 * All implementations are local-only; nothing here touches the network.
 */
export interface DatabaseStorage {
  readonly kind: 'memory' | 'indexeddb' | 'tauri' | 'session';
  load(name: string): Promise<Uint8Array | null>;
  /** Must be atomic: a failed save leaves the previous file intact. */
  save(name: string, bytes: Uint8Array): Promise<void>;
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

export class MemoryStorage implements DatabaseStorage {
  readonly kind = 'memory' as const;
  private files = new Map<string, Uint8Array>();
  async load(name: string) {
    const b = this.files.get(name);
    return b ? new Uint8Array(b) : null;
  }
  async save(name: string, bytes: Uint8Array) {
    this.files.set(name, new Uint8Array(bytes));
  }
  async list() {
    return [...this.files.keys()].sort();
  }
  async remove(name: string) {
    this.files.delete(name);
  }
}

const IDB_NAME = 'personal-treasury';
const IDB_STORE = 'databases';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(IDB_STORE, mode);
        const req = fn(t.objectStore(IDB_STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** Browser development/test storage. IndexedDB puts are transactional. */
export class IndexedDbStorage implements DatabaseStorage {
  readonly kind = 'indexeddb' as const;
  async load(name: string) {
    const v = await tx<unknown>('readonly', (s) => s.get(name));
    return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
  }
  async save(name: string, bytes: Uint8Array) {
    await tx('readwrite', (s) => s.put(bytes, name));
  }
  async list() {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    return keys.map(String).sort();
  }
  async remove(name: string) {
    await tx('readwrite', (s) => s.delete(name));
  }
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Desktop storage: `<AppData>/databases/<name>.sqlite`, written to a temporary
 * file and renamed into place so a crash mid-write cannot corrupt the database.
 */
export class TauriFsStorage implements DatabaseStorage {
  readonly kind = 'tauri' as const;
  private async fs() {
    return import('@tauri-apps/plugin-fs');
  }
  private path(name: string) {
    return `databases/${name}.sqlite`;
  }
  private async ensureDir() {
    const fs = await this.fs();
    const opts = { baseDir: fs.BaseDirectory.AppData };
    if (!(await fs.exists('databases', opts))) await fs.mkdir('databases', { ...opts, recursive: true });
  }
  async load(name: string) {
    const fs = await this.fs();
    const opts = { baseDir: fs.BaseDirectory.AppData };
    if (!(await fs.exists(this.path(name), opts))) return null;
    return fs.readFile(this.path(name), opts);
  }
  async save(name: string, bytes: Uint8Array) {
    const fs = await this.fs();
    const opts = { baseDir: fs.BaseDirectory.AppData };
    await this.ensureDir();
    const tmp = `${this.path(name)}.tmp`;
    await fs.writeFile(tmp, bytes, opts);
    await fs.rename(tmp, this.path(name), {
      oldPathBaseDir: fs.BaseDirectory.AppData,
      newPathBaseDir: fs.BaseDirectory.AppData,
    });
  }
  async list() {
    const fs = await this.fs();
    const opts = { baseDir: fs.BaseDirectory.AppData };
    await this.ensureDir();
    const entries = await fs.readDir('databases', opts);
    return entries
      .filter((e) => e.isFile && e.name.endsWith('.sqlite'))
      .map((e) => e.name.replace(/\.sqlite$/, ''))
      .sort();
  }
  async remove(name: string) {
    const fs = await this.fs();
    await fs.remove(this.path(name), { baseDir: fs.BaseDirectory.AppData });
  }
}

export function defaultStorage(): DatabaseStorage {
  if (isTauri()) return new TauriFsStorage();
  if (typeof indexedDB !== 'undefined') return new IndexedDbStorage();
  return new MemoryStorage();
}
