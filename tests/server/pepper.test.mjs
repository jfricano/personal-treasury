import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac, createHash, randomBytes, webcrypto, generateKeyPairSync, sign } from 'node:crypto';
import { createV3Server, totp } from '../../sync-server/v3.mjs';
import { startFromEnv } from '../../sync-server/server.mjs';

const key = () => randomBytes(32).toString('base64');
const hmac = (pepper, authKey) =>
  createHmac('sha256', Buffer.from(pepper, 'base64')).update(authKey).digest('base64');
function unbase32(s) {
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const c of s) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('base64');
}
async function fixture(t, initial = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pt-pepper-'));
  const keys = Object.fromEntries(
    ['pepper', 'atRestKey', 'deviceCookieKey', 'logKey'].map((name) => [name, key()]),
  );
  const receipts = [];
  let clock = Date.parse('2026-10-22T12:00:00Z'),
    server;
  const config = {
    dataDirectory: directory,
    origin: 'http://localhost',
    ...keys,
    setupSecret: key(),
    requestLogger: () => undefined,
    lifecycleLogger: (record) => receipts.push(record),
    now: () => clock,
  };
  const boot = async (extra = {}) => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    server = await createV3Server({ ...config, ...extra });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  };
  t.after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (route, body, options = {}) => {
    clock += 7000;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        'X-PT-Request': '1',
        Origin: options.web ? config.origin : 'tauri://localhost',
        ...(options.client ? { Cookie: [...options.client.values()].join('; ') } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (options.client)
      for (const cookie of response.headers.getSetCookie()) {
        const part = cookie.split(';')[0];
        options.client.set(part.split('=')[0], part);
      }
    return { status: response.status, body: await response.json() };
  };
  const dataKey = randomBytes(32),
    wrapIv = randomBytes(12);
  const wrapKey = await webcrypto.subtle.importKey('raw', randomBytes(32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  const wrapAad = Buffer.from('pt/v3/dek|fictional-owner|client-key-1');
  const wrapped = {
    iv: wrapIv.toString('base64'),
    ciphertext: Buffer.from(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv: wrapIv, additionalData: wrapAad },
        wrapKey,
        dataKey,
      ),
    ).toString('base64'),
  };
  const unwrap = async (value) =>
    Buffer.from(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(value.iv, 'base64'), additionalData: wrapAad },
        wrapKey,
        Buffer.from(value.ciphertext, 'base64'),
      ),
    );
  const credentials = {
    userId: 'fictional-owner',
    authKey: key(),
    salt: key(),
    params: { m: 65536, t: 3, p: 1 },
    kid: 'client-key-1',
    wrapped,
  };
  await boot(initial);
  const begin = await request('/api/setup/begin', credentials, {
    headers: { Authorization: `Bearer ${config.setupSecret}` },
  });
  assert.equal(begin.status, 200);
  const secret = unbase32(begin.body.totpSecret);
  assert.equal(
    (
      await request(
        '/api/setup/confirm',
        { enrollment: begin.body.enrollment, code: totp(secret, Math.floor((clock + 7000) / 30000)) },
        { headers: { Authorization: `Bearer ${config.setupSecret}` } },
      )
    ).status,
    200,
  );
  const readAccount = async () => JSON.parse(await readFile(path.join(directory, 'account.json'), 'utf8'));
  const legacy = async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    const record = await readAccount();
    delete record.verifierPepperId;
    await writeFile(path.join(directory, 'account.json'), JSON.stringify(record));
  };
  const start = (options = {}) =>
    request(
      '/api/auth/login',
      { ...credentials, client: options.web ? 'web' : 'desktop', ...options.credentials },
      options,
    );
  const finish = async (pending, options = {}) => {
    clock += 30000;
    return request(
      '/api/auth/factor',
      {
        pending: pending.body.pending,
        method: 'totp',
        code: totp(secret, Math.floor((clock + 7000) / 30000)),
        ...options.factor,
      },
      options,
    );
  };
  const login = async (options = {}) => {
    const pending = await start(options);
    assert.equal(pending.status, 200);
    return finish(pending, options);
  };
  return {
    directory,
    keys,
    config,
    credentials,
    dataKey,
    unwrap,
    receipts,
    boot,
    request,
    readAccount,
    legacy,
    start,
    finish,
    login,
    recovery: begin.body.recoveryCodes,
    clock: () => clock,
    code: () => totp(secret, Math.floor((clock + 7000) / 30000)),
    advance: (ms) => {
      clock += ms;
    },
    rotation: (next) => ({ pepper: next, pepperKeyId: '2', pepperKeys: { 1: keys.pepper } }),
  };
}

test('pepper configuration fails closed and never silently selects legacy mode', async (t) => {
  const f = await fixture(t);
  for (const extra of [
    { pepperKeyId: '' },
    { pepperKeyId: 'ID' },
    { pepperKeyId: 'bad/id' },
    { pepper: 'bad' },
    { pepperKeys: { 1: key() } },
    { pepperKeyId: '3', pepperKeys: { 1: key(), 2: key() } },
    { pepperKeys: { old: 'bad' } },
    { pepperKeyId: '2' },
  ])
    await assert.rejects(createV3Server({ ...f.config, ...extra }));
  for (const env of [
    { PT_AUTH_PEPPER_ID: '2' },
    { PT_AUTH_PEPPER_1: key() },
    { PT_AUTH_PEPPER: '', PT_AUTH_PEPPER_ID: '2' },
  ])
    await assert.rejects(startFromEnv(env), /require an active pepper/);
  const before = await f.readAccount();
  before.verifierPepperId = 'unknown';
  await writeFile(path.join(f.directory, 'account.json'), JSON.stringify(before));
  await assert.rejects(createV3Server(f.config), /Required authentication pepper/);
  assert.deepEqual(await f.readAccount(), before);
});

test('legacy records without IDs remain usable under unchanged default configuration', async (t) => {
  const f = await fixture(t);
  await f.legacy();
  await f.boot();
  assert.equal((await f.login()).status, 200);
  const record = await f.readAccount();
  assert.equal(record.verifierPepperId, undefined);
  assert.equal(record.verifier, hmac(f.keys.pepper, f.credentials.authKey));
});

test('password-only, invalid factors, abandoned and expired pending proofs cannot migrate', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  await f.boot(f.rotation(next));
  const before = await f.readAccount();
  const wrong = await f.start({ credentials: { authKey: key() } });
  assert.equal(wrong.status, 401);
  const unknown = await f.start({ credentials: { userId: 'unknown-owner', authKey: key() } });
  assert.deepEqual(wrong.body, unknown.body);
  const pending = await f.start();
  assert.equal(pending.status, 200);
  assert.deepEqual(await f.readAccount(), before);
  assert.equal((await f.finish(pending, { factor: { code: 'wrong' } })).status, 401);
  assert.deepEqual(await f.readAccount(), before);
  f.advance(6 * 60000);
  assert.equal((await f.finish(pending)).status, 401);
  assert.deepEqual(await f.readAccount(), before);
  assert(!f.receipts.some((r) => r.type === 'auth_pepper_migrated'));
});

test('full native authentication migrates only verifier metadata; new-key-only restart retains access', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  const before = await f.readAccount();
  await f.boot(f.rotation(next));
  assert.deepEqual(f.receipts.at(-1), {
    type: 'auth_pepper_loaded',
    activePepperId: '2',
    verifierPepperId: '1',
    migrationPending: true,
  });
  const signed = await f.login();
  assert.equal(signed.status, 200);
  assert.deepEqual(signed.body.wrapped, f.credentials.wrapped);
  const after = await f.readAccount();
  assert.equal(after.verifierPepperId, '2');
  assert.equal(after.verifier, hmac(next, f.credentials.authKey));
  for (const field of [
    'userId',
    'salt',
    'params',
    'kid',
    'wrapped',
    'totp',
    'devices',
    'passkeys',
    'recovery',
  ])
    assert.deepEqual(after[field], before[field]);
  assert.deepEqual(f.receipts.at(-1), {
    type: 'auth_pepper_migrated',
    previousPepperId: '1',
    verifierPepperId: '2',
  });
  const serialized =
    JSON.stringify(f.receipts) + (await readFile(path.join(f.directory, 'account.json'), 'utf8'));
  for (const secret of [f.credentials.authKey, f.keys.pepper, next, f.credentials.wrapped.ciphertext])
    assert(!serialized.includes(secret));
  await f.boot({ pepper: next, pepperKeyId: '2' });
  assert.equal((await f.request('/api/auth/session', undefined, { token: signed.body.token })).status, 401);
  assert.equal((await f.login()).status, 200);
  assert.equal(f.receipts.at(-1).migrationPending, false);
});

test('web recovery factor migrates while preserving one-use consumption and cookies', async (t) => {
  const f = await fixture(t),
    next = key(),
    client = new Map();
  await f.legacy();
  await f.boot(f.rotation(next));
  const pending = await f.start({ web: true, client });
  const signed = await f.finish(pending, {
    web: true,
    client,
    factor: { method: 'recovery', code: f.recovery[0] },
  });
  assert.equal(signed.status, 200);
  assert.equal((await f.request('/api/auth/session', undefined, { web: true, client })).status, 200);
  const record = await f.readAccount();
  assert.equal(record.verifierPepperId, '2');
  assert.equal(record.recovery.length, f.recovery.length - 1);
  const another = await f.start({ web: true, client });
  assert.equal(
    (await f.finish(another, { web: true, client, factor: { method: 'recovery', code: f.recovery[0] } }))
      .status,
    401,
  );
});

test('native enrolled-device factor still authenticates and migrates without replacing its key', async (t) => {
  const f = await fixture(t),
    next = key();
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  await f.legacy();
  const record = await f.readAccount();
  record.devices = [{ id: 'synthetic-device', publicKey }];
  await writeFile(path.join(f.directory, 'account.json'), JSON.stringify(record));
  await f.boot(f.rotation(next));
  const pending = await f.start();
  const challenge = await f.request('/api/auth/factor/device', { pending: pending.body.pending });
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Buffer.from(challenge.body.challenge, 'base64'),
    ),
  ).toString('base64');
  assert.equal(
    (await f.finish(pending, { factor: { method: 'device', deviceId: 'synthetic-device', signature } }))
      .status,
    200,
  );
  assert.deepEqual((await f.readAccount()).devices, record.devices);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
});

test('web passkey proof migrates and preserves its anti-replay counter', async (t) => {
  const f = await fixture(t),
    next = key(),
    client = new Map();
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
    jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 32]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 32]),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  const id = randomBytes(16).toString('base64url');
  await f.legacy();
  const record = await f.readAccount();
  record.passkeys = [{ id, publicKey: cose.toString('base64'), counter: 0 }];
  await writeFile(path.join(f.directory, 'account.json'), JSON.stringify(record));
  await f.boot(f.rotation(next));
  const pending = await f.start({ web: true, client });
  const options = await f.request('/api/auth/factor/options', {}, { web: true, client });
  const data = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: options.body.challenge,
      origin: 'http://localhost',
      crossOrigin: false,
    }),
  );
  const auth = Buffer.concat([
    createHash('sha256').update('localhost').digest(),
    Buffer.from([5, 0, 0, 0, 1]),
  ]);
  const signature = sign(
    'sha256',
    Buffer.concat([auth, createHash('sha256').update(data).digest()]),
    pair.privateKey,
  );
  const assertion = {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: data.toString('base64url'),
      authenticatorData: auth.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
  assert.equal(
    (await f.finish(pending, { web: true, client, factor: { method: 'passkey', assertion } })).status,
    200,
  );
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  assert.equal((await f.readAccount()).passkeys[0].counter, 1);
});

test('concurrent old pending flows cannot overwrite a migrated verifier or reuse factors', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  await f.boot(f.rotation(next));
  const first = await f.start(),
    second = await f.start();
  f.advance(30000);
  const code = f.code();
  const results = await Promise.all(
    [first, second].map((p) =>
      f.request('/api/auth/factor', {
        pending: p.body.pending,
        method: 'totp',
        code,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  assert.equal((await f.readAccount()).verifier, hmac(next, f.credentials.authKey));
});

test('step-up, unlock and native password change use the record version and invalidate pending sessions', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  await f.boot(f.rotation(next));
  const signed = await f.login(),
    token = signed.body.token,
    client = new Map();
  assert.equal((await f.login({ web: true, client })).status, 200);
  f.advance(30000);
  const beforeProof = await f.readAccount();
  assert.equal(
    (
      await f.request(
        '/api/auth/step-up',
        { ...f.credentials, method: 'totp', code: f.code() },
        { web: true, client },
      )
    ).status,
    200,
  );
  assert.equal((await f.readAccount()).verifier, beforeProof.verifier);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  const pending = await f.start();
  assert.equal((await f.request('/api/auth/lock', {}, { token })).status, 200);
  const before = await f.readAccount();
  assert.equal((await f.request('/api/auth/unlock', f.credentials, { token })).status, 200);
  assert.deepEqual(await f.readAccount(), before);
  assert.equal((await f.request('/api/auth/password/key', f.credentials, { token })).status, 200);
  const changed = {
    ...f.credentials,
    authKey: key(),
    salt: key(),
    wrapped: { iv: 'new', ciphertext: 'new-synthetic-wrapper' },
    currentAuthKey: f.credentials.authKey,
  };
  assert.equal((await f.request('/api/auth/password', changed, { token })).status, 200);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  assert.equal((await f.readAccount()).verifier, hmac(next, changed.authKey));
  assert.equal((await f.finish(pending)).status, 401);
  assert.equal((await f.request('/api/auth/session', undefined, { web: true, client })).status, 401);
  assert.equal((await f.request('/api/auth/session', undefined, { token })).status, 200);
  assert.equal((await f.start()).status, 401);
  assert.equal((await f.start({ credentials: { authKey: changed.authKey } })).status, 200);
});

for (const committed of [false, true])
  test(`verifier write failure (${committed ? 'after' : 'before'} durable commit) fails closed until reconciled restart`, async (t) => {
    const f = await fixture(t),
      next = key();
    await f.legacy();
    await f.boot({
      ...f.rotation(next),
      persistVerifier: async (file, value) => {
        if (committed) {
          const temp = file + '.fault-test';
          await writeFile(temp, JSON.stringify(value));
          await rename(temp, file);
        }
        throw new Error('synthetic persistence acknowledgement failure');
      },
    });
    assert.equal((await f.login()).status, 503);
    assert.equal((await f.readAccount()).verifierPepperId, committed ? '2' : undefined);
    assert.equal((await f.start()).status, 503);
    assert.equal((await f.request('/api/auth/session')).status, 503);
    await f.boot(committed ? { pepper: next, pepperKeyId: '2' } : f.rotation(next));
    assert.equal((await f.login()).status, 200);
  });

test('receipt failure cannot undo durable migration or expose credential contents', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  await f.boot({
    ...f.rotation(next),
    lifecycleLogger: () => {
      throw new Error('synthetic receipt failure');
    },
  });
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
});

test('new enrollment writes the active pepper version; MFA recovery eligibility alone never migrates', async (t) => {
  const next = key(),
    f = await fixture(t, { pepper: next, pepperKeyId: '2' });
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  assert.equal((await f.readAccount()).verifier, hmac(next, f.credentials.authKey));
  const g = await fixture(t);
  await g.legacy();
  await g.boot({ ...g.rotation(key()), mfaReset: key() });
  const before = await g.readAccount(),
    pending = await g.start();
  assert.equal(pending.status, 200);
  assert.equal(pending.body.resetRequired, true);
  assert.deepEqual(await g.readAccount(), before);
});

test('encrypted client key and snapshot round-trip across migration and a new-key-only restart', async (t) => {
  const f = await fixture(t),
    next = key(),
    signed = await f.login();
  const iv = randomBytes(12),
    plain = Buffer.from('FICTIONAL ENCRYPTED TREASURY ROUND TRIP');
  const aes = await webcrypto.subtle.importKey('raw', f.dataKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const envelope = {
    format: 'pt-snapshot',
    v: 2,
    kid: f.credentials.kid,
    rev: 1,
    purpose: 'snapshot',
    ref: 'treasury',
    nonce: randomBytes(16).toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain)).toString(
      'base64',
    ),
  };
  assert.equal(
    (
      await f.request(
        '/api/sync/head',
        { envelope },
        { method: 'PUT', token: signed.body.token, headers: { 'If-Match': '"0"' } },
      )
    ).status,
    200,
  );
  const snapshot = await readFile(path.join(f.directory, 'snapshots', '1.json'), 'utf8');
  await f.legacy();
  await f.boot(f.rotation(next));
  const migrated = await f.login();
  assert.equal(migrated.status, 200);
  assert.deepEqual(await f.unwrap(migrated.body.wrapped), f.dataKey);
  const synced = await f.request('/api/sync/versions/1', undefined, { token: migrated.body.token });
  assert.equal(synced.status, 200);
  assert.deepEqual(synced.body.envelope, envelope);
  assert.deepEqual(
    Buffer.from(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aes,
        Buffer.from(synced.body.envelope.ciphertext, 'base64'),
      ),
    ),
    plain,
  );
  await f.boot({ pepper: next, pepperKeyId: '2' });
  const reopened = await f.login();
  assert.equal(reopened.status, 200);
  assert.deepEqual(await f.unwrap(reopened.body.wrapped), f.dataKey);
  assert.equal(
    (await f.request('/api/sync/head', undefined, { token: reopened.body.token })).body.revision,
    1,
  );
  assert.equal(await readFile(path.join(f.directory, 'snapshots', '1.json'), 'utf8'), snapshot);
});

test('inactive legacy account backup stays immutable and requires its old pepper for an isolated restore', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  const backup = await readFile(path.join(f.directory, 'account.json'), 'utf8');
  const isolated = await mkdtemp(path.join(tmpdir(), 'pt-pepper-restore-'));
  t.after(() => rm(isolated, { recursive: true, force: true }));
  await writeFile(path.join(isolated, 'account.json'), backup);
  await f.boot(f.rotation(next));
  assert.equal((await f.login()).status, 200);
  await assert.rejects(
    createV3Server({ ...f.config, dataDirectory: isolated, pepper: next, pepperKeyId: '2' }),
    /Required authentication pepper/,
  );
  const restored = await createV3Server({ ...f.config, dataDirectory: isolated, ...f.rotation(next) });
  await new Promise((resolve) => restored.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => restored.close(resolve));
  assert.equal(await readFile(path.join(isolated, 'account.json'), 'utf8'), backup);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
});

test('completed operational MFA recovery preserves its new factors when migrating the verifier', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  await f.boot({ ...f.rotation(next), mfaReset: key() });
  const pending = await f.start();
  assert.equal(pending.body.resetRequired, true);
  const begin = await f.request('/api/auth/factor/reset/begin', { pending: pending.body.pending });
  assert.equal(begin.status, 200);
  const secret = unbase32(begin.body.totpSecret);
  f.advance(30000);
  const response = await f.request('/api/auth/factor/reset/confirm', {
    pending: pending.body.pending,
    code: totp(secret, Math.floor((f.clock() + 7000) / 30000)),
  });
  assert.equal(response.status, 200);
  assert.equal((await f.readAccount()).verifierPepperId, '2');
  assert.equal((await f.readAccount()).recovery.length, begin.body.recoveryCodes.length);
  assert((await f.readAccount()).lastTotp > 0);
});

test('queued public authentication cannot proceed after an uncertain verifier commit', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  let entered, fail;
  const writing = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    fail = resolve;
  });
  await f.boot({
    ...f.rotation(next),
    persistVerifier: async () => {
      entered();
      await blocked;
      throw new Error('synthetic uncertain commit');
    },
  });
  const pending = await f.start();
  const migrating = f.finish(pending);
  await writing;
  const queued = f.request('/api/auth/prelogin', { userId: f.credentials.userId });
  // Let the bounded request body enter the existing serialization queue.
  await new Promise((resolve) => setTimeout(resolve, 20));
  fail();
  assert.equal((await migrating).status, 503);
  assert.equal((await queued).status, 503);
});

test('environment entry point loads the explicit prior-key mapping without migrating at boot', async (t) => {
  const f = await fixture(t),
    next = key();
  await f.legacy();
  const before = await f.readAccount();
  const server = await startFromEnv({
    PT_AUTH_PEPPER: next,
    PT_AUTH_PEPPER_ID: '2',
    PT_AUTH_PEPPER_1: f.keys.pepper,
    PT_AT_REST_KEY: f.keys.atRestKey,
    PT_DEVICE_COOKIE_KEY: f.keys.deviceCookieKey,
    PT_LOG_KEY: f.keys.logKey,
    PT_PUBLIC_ORIGIN: f.config.origin,
    PT_SYNC_DATA_DIR: f.directory,
    PT_SYNC_HOST: '127.0.0.1',
    PORT: '0',
  });
  try {
    assert.deepEqual(await f.readAccount(), before);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    assert.equal(response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
