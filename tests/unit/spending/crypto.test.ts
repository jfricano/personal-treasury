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
  await expect(validatePassword('short', 'owner')).rejects.toThrow();
  await expect(validatePassword('contains owner in this long password', 'owner')).rejects.toThrow();
  await expect(validatePassword('passwordpassword', 'owner')).rejects.toThrow('common');
  await expect(validatePassword('😀'.repeat(8), '')).rejects.toThrow('15');
  await expect(validatePassword('😀'.repeat(15), '')).resolves.toBe('😀'.repeat(15));
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

import { readOfflineRecord, unlockOffline } from '@/security/offline';
it('SEC-OFFLINE wrapped credentials unlock only with the password and are bound to the service', async () => {
  const password = 'five offline words make a password',
    salt = base64(random()),
    keys = await derivePasswordKeys(password, salt, DEFAULT_KDF),
    raw = random(),
    wrapped = await wrapDataKey(keys.wrapKey, raw, 'harper', '1');
  const record = {
    v: 1 as const,
    origin: 'https://fixture.example',
    userId: 'harper',
    kid: '1',
    salt,
    params: DEFAULT_KDF,
    wrapped,
  };
  const text = JSON.stringify(record);
  expect(text).not.toContain(password);
  expect(text).not.toContain(base64(raw));
  const key = await unlockOffline(readOfflineRecord(text, record.origin), password);
  expect(key.extractable).toBe(false);
  const original = await importDataKey(raw);
  raw.fill(0);
  const envelope = await encryptObject(original, new TextEncoder().encode('offline treasury canary'), {
    purpose: 'local',
    ref: 'default',
    rev: 1,
  });
  expect(
    new TextDecoder().decode(
      await decryptObject(key, envelope, { purpose: 'local', ref: 'default', rev: 1 }),
    ),
  ).toBe('offline treasury canary');
  await expect(unlockOffline(record, 'a different wrong password')).rejects.toThrow();
  expect(() => readOfflineRecord(text, 'https://other.example')).toThrow('another service');
  expect(() =>
    readOfflineRecord(JSON.stringify({ ...record, params: { m: 8192, t: 1, p: 1 } }), record.origin),
  ).toThrow('Unsafe');
});
