import type { ReviewBackend } from './index';
/** The review file and index are separate from database snapshots, undo and backups. */
export function localReviewBackend(profile: string, kind: string): ReviewBackend {
  const key = `pt-v3-reviews:${encodeURIComponent(profile)}`;
  if (kind === 'session')
    return {
      load: async () => sessionStorage.getItem(key),
      save: async (value) => {
        sessionStorage.setItem(key, value);
      },
    };
  if (kind === 'tauri')
    return {
      load: async () => {
        const fs = await import('@tauri-apps/plugin-fs');
        const opts = { baseDir: fs.BaseDirectory.AppData };
        const path = `reviews/${encodeURIComponent(profile)}.json`;
        return (await fs.exists(path, opts)) ? fs.readTextFile(path, opts) : null;
      },
      save: async (value) => {
        const fs = await import('@tauri-apps/plugin-fs');
        const baseDir = fs.BaseDirectory.AppData;
        await fs.mkdir('reviews', { baseDir, recursive: true });
        const path = `reviews/${encodeURIComponent(profile)}.json`;
        await fs.writeTextFile(`${path}.tmp`, value, { baseDir });
        await fs.rename(`${path}.tmp`, path, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
      },
    };
  const transact = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const open = indexedDB.open('personal-treasury-reviews', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('reviews');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result,
          tx = db.transaction('reviews', mode),
          request = fn(tx.objectStore('reviews'));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  return {
    load: async () => (await transact('readonly', (s) => s.get(key))) as string | null,
    save: async (value) => {
      await transact('readwrite', (s) => s.put(value, key));
    },
  };
}
