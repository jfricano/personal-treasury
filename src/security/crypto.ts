import { masterKey, validateKdf } from './kdf';
export { masterKey, validateKdf } from './kdf';
export interface KdfParameters {
  m: number;
  t: number;
  p: number;
}
export const DEFAULT_KDF: KdfParameters = { m: 65536, t: 3, p: 1 };
export const bytes = (value: Uint8Array) => new Uint8Array(value);
export function base64(value: Uint8Array): string {
  let binary = '';
  for (const v of value) binary += String.fromCharCode(v);
  return btoa(binary);
}
export function unbase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export const random = (size = 32) => crypto.getRandomValues(new Uint8Array(size));
export const userId = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export function validatePassword(password: string, id: string) {
  const p = password.normalize('NFKC');
  if (p.length < 15 || p.length > 256) throw new Error('Use a password of 15–256 characters.');
  if (id && p.toLowerCase().includes(userId(id)))
    throw new Error('The password must not contain your User ID.');
  if (
    [
      'passwordpassword',
      'password123456789',
      '123456789012345',
      'qwertyuiopasdfgh',
      'letmeinletmeinletmein',
    ].includes(p.toLowerCase())
  )
    throw new Error('Choose a less common password.');
  return p;
}
export async function derivePasswordKeys(password: string, salt: string, params: KdfParameters) {
  validateKdf(params);
  let mk: Uint8Array;
  if (typeof Worker !== 'undefined') {
    mk = await new Promise<Uint8Array>((resolve, reject) => {
      const worker = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Password derivation timed out'));
      }, 60000);
      worker.onmessage = (e) => {
        clearTimeout(timeout);
        worker.terminate();
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.key);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error('Password derivation failed'));
      };
      worker.postMessage({ password, salt, params });
    });
  } else mk = await masterKey(password, salt, params);
  const material = await crypto.subtle.importKey('raw', bytes(mk), 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  mk.fill(0);
  const hkdf = (label: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(32),
    info: new TextEncoder().encode(label),
  });
  const authKey = base64(
    new Uint8Array(await crypto.subtle.deriveBits(hkdf('pt/v3/auth-key'), material, 256)),
  );
  const wrapKey = await crypto.subtle.deriveKey(
    hkdf('pt/v3/key-wrap'),
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { authKey, wrapKey };
}
export interface Sealed {
  iv: string;
  ciphertext: string;
}
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Sealed> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    bytes(plaintext),
  );
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}
export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(unbase64(sealed.iv)), additionalData: new TextEncoder().encode(aad) },
      key,
      bytes(unbase64(sealed.ciphertext)),
    ),
  );
}
export async function importDataKey(raw: Uint8Array) {
  return crypto.subtle.importKey('raw', bytes(raw), 'HKDF', false, ['deriveKey']);
}
export async function wrapDataKey(wrapKey: CryptoKey, raw: Uint8Array, id: string, kid: string) {
  return seal(wrapKey, raw, `pt/v3/dek|${userId(id)}|${kid}`);
}
export async function unwrapDataKey(wrapKey: CryptoKey, wrapped: Sealed, id: string, kid: string) {
  const raw = await open(wrapKey, wrapped, `pt/v3/dek|${userId(id)}|${kid}`);
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}
export interface Envelope extends Sealed {
  format: 'pt-snapshot' | 'pt-object';
  v: 2;
  kid: string;
  rev: number;
  prev: string;
  created: string;
  device: string;
  nonce: string;
  purpose: string;
  ref: string;
}
function header(e: Envelope) {
  return JSON.stringify({
    format: e.format,
    v: e.v,
    kid: e.kid,
    rev: e.rev,
    prev: e.prev,
    created: e.created,
    device: e.device,
    purpose: e.purpose,
    ref: e.ref,
    nonce: e.nonce,
  });
}
async function objectKey(dek: CryptoKey, e: Envelope) {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytes(unbase64(e.nonce)),
      info: new TextEncoder().encode(`pt/v3/${e.purpose}`),
    },
    dek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptObject(
  dek: CryptoKey,
  plaintext: Uint8Array,
  opts: {
    purpose: string;
    ref: string;
    rev: number;
    kid?: string;
    prev?: string;
    created?: string;
    device?: string;
  },
): Promise<Envelope> {
  const e: Envelope = {
    format: opts.purpose === 'snapshot' ? 'pt-snapshot' : 'pt-object',
    v: 2,
    kid: opts.kid ?? '1',
    rev: opts.rev,
    prev: opts.prev ?? 'unchecked',
    created: opts.created ?? new Date().toISOString(),
    device: opts.device ?? 'Personal Treasury',
    nonce: base64(random()),
    purpose: opts.purpose,
    ref: opts.ref,
    iv: '',
    ciphertext: '',
  };
  return { ...e, ...(await seal(await objectKey(dek, e), plaintext, header(e))) };
}
export async function decryptObject(
  dek: CryptoKey,
  e: Envelope,
  expected: { purpose: string; ref: string; rev: number; highest?: number },
): Promise<Uint8Array> {
  if (
    e.v !== 2 ||
    e.purpose !== expected.purpose ||
    e.ref !== expected.ref ||
    e.rev !== expected.rev ||
    e.rev < (expected.highest ?? 0) ||
    !['pt-snapshot', 'pt-object'].includes(e.format)
  )
    throw new Error('Encrypted object identity or revision mismatch');
  return open(await objectKey(dek, e), e, header(e));
}
export async function encryptedBackup(plaintext: Uint8Array, password: string) {
  validatePassword(password, '');
  const salt = base64(random()),
    { wrapKey } = await derivePasswordKeys(password, salt, DEFAULT_KDF);
  return JSON.stringify({
    format: 'ptbackup',
    v: 1,
    salt,
    params: DEFAULT_KDF,
    ...(await seal(wrapKey, plaintext, 'pt/v3/backup')),
  });
}
export async function decryptBackup(text: string, password: string) {
  const b = JSON.parse(text);
  if (b.format !== 'ptbackup' || b.v !== 1) throw new Error('Not an encrypted treasury backup');
  const { wrapKey } = await derivePasswordKeys(password, b.salt, b.params);
  return open(wrapKey, b, 'pt/v3/backup');
}
