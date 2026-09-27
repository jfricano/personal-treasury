interface DeviceKey {
  id: string;
  privateKey: CryptoKey;
  publicKey: string;
}
function record<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('personal-treasury-device-key', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        transaction = db.transaction('keys', mode),
        result = fn(transaction.objectStore('keys'));
      transaction.oncomplete = () => {
        db.close();
        resolve(result.result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}
export const readDeviceKey = (origin: string) =>
  record<DeviceKey | undefined>('readonly', (s) => s.get(origin));
export const saveDeviceKey = (origin: string, key: DeviceKey) =>
  record('readwrite', (s) => s.put(key, origin));
