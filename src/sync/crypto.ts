/** An opaque, authenticated snapshot. The server never receives the passphrase. */
export interface SnapshotEnvelope {
  format: 'personal-treasury-snapshot';
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

const FORMAT = 'personal-treasury-snapshot';
const ITERATIONS = 310_000;
const encoder = new TextEncoder();

export class SnapshotCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotCryptoError';
  }
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues)
    throw new SnapshotCryptoError('This device does not provide WebCrypto.');
  return globalThis.crypto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function fromBase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new SnapshotCryptoError('The cloud snapshot has invalid encoding.');
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new SnapshotCryptoError('The cloud snapshot has invalid encoding.');
  }
}

function bytesForCrypto(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function keyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!passphrase) throw new SnapshotCryptoError('Enter a sync passphrase.');
  const crypto = requireCrypto();
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytesForCrypto(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a complete SQLite database before sending it to cloud storage. */
export async function encryptSnapshot(bytes: Uint8Array, passphrase: string): Promise<SnapshotEnvelope> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0)
    throw new SnapshotCryptoError('The database snapshot is empty.');
  const crypto = requireCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPassphrase(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesForCrypto(iv) },
    key,
    bytesForCrypto(bytes),
  );
  return {
    format: FORMAT,
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Decrypt and authenticate a snapshot. A wrong passphrase and tampering are indistinguishable. */
export async function decryptSnapshot(envelope: SnapshotEnvelope, passphrase: string): Promise<Uint8Array> {
  if (!envelope || envelope.format !== FORMAT || envelope.version !== 1)
    throw new SnapshotCryptoError('This cloud snapshot format is not supported.');
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17)
    throw new SnapshotCryptoError('The cloud snapshot is incomplete or corrupted.');
  const key = await keyFromPassphrase(passphrase, salt);
  try {
    const plaintext = await requireCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: bytesForCrypto(iv) },
      key,
      bytesForCrypto(ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new SnapshotCryptoError(
      'Could not unlock the cloud snapshot. Check the passphrase or restore another version.',
    );
  }
}
