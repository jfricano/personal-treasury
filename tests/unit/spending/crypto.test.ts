import { it, expect } from 'vitest';
import { argon2 } from 'node:crypto';
import { promisify } from 'node:util';
import {
  DEFAULT_KDF,
  base64,
  random,
  masterKey,
  derivePasswordKeys,
  wrapDataKey,
  unwrapDataKey,
  encryptObject,
  decryptObject,
  importDataKey,
  validatePassword,
} from '@/security/crypto';
it('SEC-AUTH: Argon2id matches Node, key labels differ and parameter downgrades fail', async () => {
  const salt = random(),
    password = 'five long random words are safer';
  const actual = await masterKey(password, base64(salt), DEFAULT_KDF);
  const reference = await promisify(argon2)('argon2id', {
    message: password,
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 65536,
    passes: 3,
  });
  expect(Buffer.from(actual)).toEqual(reference);
  await expect(masterKey(password, base64(salt), { m: 8192, t: 1, p: 1 })).rejects.toThrow('Unsafe');
  expect(() => validatePassword('short', 'owner')).toThrow();
  expect(() => validatePassword('contains owner in this long password', 'owner')).toThrow();
});
it('SEC-AUTH/SEC-SYNC: wrapped keys, object identities, revisions and every header are authenticated', async () => {
  const password = 'a synthetic password for crypto tests',
    salt = base64(random()),
    { wrapKey } = await derivePasswordKeys(password, salt, DEFAULT_KDF),
    raw = random(),
    wrapped = await wrapDataKey(wrapKey, raw, 'harper', '1'),
    dek = await unwrapDataKey(wrapKey, wrapped, 'harper', '1');
  const data = new TextEncoder().encode('treasury canary'),
    e = await encryptObject(dek, data, { purpose: 'snapshot', ref: 'treasury', rev: 3 });
  expect(await decryptObject(dek, e, { purpose: 'snapshot', ref: 'treasury', rev: 3 })).toEqual(data);
  await expect(decryptObject(dek, e, { purpose: 'snapshot', ref: 'treasury', rev: 5 })).rejects.toThrow();
  await expect(
    decryptObject(dek, e, { purpose: 'snapshot', ref: 'treasury', rev: 3, highest: 4 }),
  ).rejects.toThrow();
  for (const key of ['kid', 'prev', 'created', 'device', 'nonce'] as const)
    await expect(
      decryptObject(dek, { ...e, [key]: e[key] + 'x' }, { purpose: 'snapshot', ref: 'treasury', rev: 3 }),
    ).rejects.toThrow();
  await expect(
    decryptObject(await importDataKey(random()), e, { purpose: 'snapshot', ref: 'treasury', rev: 3 }),
  ).rejects.toThrow();
});
