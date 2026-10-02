import type { SecurityClient } from './client';
import { base64, unbase64 } from './crypto';
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

export const removeDeviceKey = (origin: string) => record('readwrite', (s) => s.delete(origin));

export async function deviceProof(client: SecurityClient, device: DeviceKey) {
  const { challenge } = await client.request<{ challenge: string }>('/api/auth/device/challenge', 'POST', {
    deviceId: device.id,
  });
  const signature = base64(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        device.privateKey,
        new Uint8Array(unbase64(challenge)),
      ),
    ),
  );
  return { challenge, signature };
}
