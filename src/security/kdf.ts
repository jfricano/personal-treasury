import { argon2id } from 'hash-wasm';
import type { KdfParameters } from './crypto';
export function validateKdf(p: KdfParameters) {
  if (
    !Number.isInteger(p.m) ||
    !Number.isInteger(p.t) ||
    p.m < 47104 ||
    p.m > 262144 ||
    p.t < 1 ||
    p.t > 10 ||
    p.p !== 1
  )
    throw new Error('Unsafe or unsupported password parameters.');
}
export async function masterKey(password: string, salt: string, params: KdfParameters): Promise<Uint8Array> {
  validateKdf(params);
  const s = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  if (s.length !== 32) throw new Error('Invalid password salt');
  return argon2id({
    password: password.normalize('NFKC'),
    salt: s,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: 'binary',
  });
}
