import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHash, webcrypto } from 'node:crypto';
import { createV3Server, totp } from '../../sync-server/v3.mjs';
function fromBase32(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString('base64');
}
async function fixture(t, legacy = false, extra = {}) {
  let clock = Date.parse('2026-09-27T12:00:00Z');
  const directory = await mkdtemp(path.join(tmpdir(), 'pt-v3-test-'));
  const legacyToken = randomBytes(32).toString('base64url');
  if (legacy) {
    await mkdir(path.join(directory, 'versions'));
    await writeFile(
      path.join(directory, 'versions', '1.json'),
      JSON.stringify({
        revision: 1,
        createdAt: '2026-08-01T00:00:00.000Z',
        envelope: { ciphertext: 'legacy ciphertext' },
      }),
    );
    await writeFile(path.join(directory, 'head.json'), JSON.stringify({ revision: 1 }));
  }
  const origin = 'http://localhost';
  const keys = Object.fromEntries(
    ['pepper', 'atRestKey', 'deviceCookieKey', 'logKey'].map((k) => [k, randomBytes(32).toString('base64')]),
  );
  const setupSecret = randomBytes(32).toString('base64url'),
    server = await createV3Server({
      dataDirectory: directory,
      origin,
      ...keys,
      setupSecret,
      legacyToken: legacy ? legacyToken : undefined,
      requestLogger: () => undefined,
      now: () => clock,
      ...extra,
    });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let cookies = '';
  const call = async (url, body, opts = {}) => {
    if (opts.advance !== false) clock += 7000;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        'X-PT-Request': '1',
        Origin: origin,
        Cookie: cookies,
        ...opts.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of response.headers.getSetCookie()) {
      const part = c.split(';')[0],
        name = part.split('=')[0];
      cookies = cookies
        .split('; ')
        .filter((v) => !v.startsWith(name + '='))
        .concat(part)
        .filter(Boolean)
        .join('; ');
    }
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const credentials = {
    userId: 'harper',
    authKey: randomBytes(32).toString('base64'),
    salt: randomBytes(32).toString('base64'),
    params: { m: 65536, t: 3, p: 1 },
    wrapped: { iv: 'fake', ciphertext: 'wrapped key canary' },
    kid: '1',
  };
  const setupHeaders = { Authorization: `Bearer ${setupSecret}`, Origin: 'tauri://localhost' };
  const begin = await call('/api/setup/begin', credentials, { headers: setupHeaders });
  assert.equal(begin.status, 200);
  const secret = fromBase32(begin.body.totpSecret);
  const confirm = await call(
    '/api/setup/confirm',
    { enrollment: begin.body.enrollment, code: totp(secret, Math.floor((clock + 7000) / 30000)) },
    { headers: setupHeaders },
  );
  assert.equal(confirm.status, 200);
  const login = async () => {
    clock += 30000;
    assert.equal((await call('/api/auth/login', credentials)).status, 200);
    const response = await call('/api/auth/factor', {
      method: 'totp',
      code: totp(secret, Math.floor((clock + 7000) / 30000)),
    });
    assert.equal(response.status, 200);
    return response;
  };
  const desktop = async () => {
    clock += 30000;
    const headers = { Origin: 'tauri://localhost', Cookie: '' };
    const pending = await call('/api/auth/login', { ...credentials, client: 'desktop' }, { headers });
    assert.equal(pending.status, 200);
    const result = await call(
      '/api/auth/factor',
      {
        pending: pending.body.pending,
        method: 'totp',
        code: totp(secret, Math.floor((clock + 7000) / 30000)),
      },
      { headers },
    );
    assert.equal(result.status, 200);
    return { ...headers, Authorization: `Bearer ${result.body.token}` };
  };
  return {
    call,
    desktop,
    legacyToken,
    login,
    credentials,
    directory,
    secret,
    server,
    config: { dataDirectory: directory, origin, ...keys, setupSecret, requestLogger: () => undefined },
    recoveryCodes: begin.body.recoveryCodes,
    cookie: () => cookies,
    advance: (ms) => {
      clock += ms;
    },
    clock: () => clock,
  };
}
test('SEC-MFA TOTP matches RFC 6238 SHA-1 vector', () => {
  assert.equal(totp(Buffer.from('12345678901234567890').toString('base64'), 1, 8), '94287082');
});
test('SEC-AUTH setup closes, verifier and wrapped key are protected, unknown IDs give the same errors', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/setup/begin', {})).status, 404);
  const known = await f.call('/api/auth/prelogin', { userId: 'harper' }),
    unknown = await f.call('/api/auth/prelogin', { userId: 'other' });
  assert.deepEqual(known.body.params, unknown.body.params);
  assert.notEqual(known.body.salt, unknown.body.salt);
  const a = await f.call('/api/auth/login', { userId: 'harper', authKey: 'wrong' }),
    b = await f.call('/api/auth/login', { userId: 'other', authKey: 'wrong' });
  assert.deepEqual(a.body, b.body);
  const disk = await readFile(path.join(f.directory, 'account.json'), 'utf8');
  assert(!disk.includes(f.credentials.authKey));
  assert(!disk.includes('wrapped key canary'));
});
test('SEC-SESS/CSRF sessions require second factor, lock and expire on the server', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/sync/head')).status, 401);
  const login = await f.login();
  assert(
    login.headers
      .getSetCookie()
      .some(
        (c) =>
          c.startsWith('__Host-pt_session=') &&
          c.includes('HttpOnly') &&
          c.includes('Secure') &&
          c.includes('SameSite=Strict'),
      ),
  );
  assert.equal((await f.call('/api/sync/head')).status, 200);
  assert.equal(
    (await f.call('/api/auth/lock', {}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
    403,
  );
  await f.call('/api/auth/lock', {});
  assert.equal((await f.call('/api/sync/head')).body.error, 'locked');
  assert.equal((await f.call('/api/auth/unlock', f.credentials)).status, 200);
  f.advance(12 * 3600000);
  assert.equal((await f.call('/api/auth/unlock', f.credentials)).body.error, 'expired');
});
const envelope = (purpose, ref, rev) => ({
  format: purpose === 'snapshot' ? 'pt-snapshot' : 'pt-object',
  v: 2,
  kid: '1',
  purpose,
  ref,
  rev,
  nonce: 'nonce',
  iv: 'iv',
  ciphertext: 'ciphertext',
});
test('SEC-SYNC/REV conditional writes serialize, tombstones prevent resurrection, headers cover errors', async (t) => {
  const f = await fixture(t);
  await f.login();
  const [one, two] = await Promise.all([
    f.call(
      '/api/sync/head',
      { envelope: envelope('snapshot', 'treasury', 1) },
      { method: 'PUT', headers: { 'If-Match': '"0"' } },
    ),
    f.call(
      '/api/sync/head',
      { envelope: envelope('snapshot', 'treasury', 1) },
      { method: 'PUT', headers: { 'If-Match': '"0"' } },
    ),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  const ref = '11111111-1111-4111-8111-111111111111',
    body = { envelope: envelope('review', ref, 1), header: envelope('review-header', ref, 1) };
  assert.equal(
    (await f.call(`/api/review/${ref}`, body, { method: 'PUT', headers: { 'If-Match': '"0"' } })).status,
    200,
  );
  assert.equal(
    (await f.call(`/api/review/${ref}`, {}, { method: 'DELETE', headers: { 'If-Match': '"1"' } })).status,
    200,
  );
  assert.equal(
    (await f.call(`/api/review/${ref}`, body, { method: 'PUT', headers: { 'If-Match': '"0"' } })).status,
    410,
  );
  assert.equal((await readdir(path.join(f.directory, 'reviews'))).length, 0);
  const missing = await f.call('/api/missing');
  assert.equal(missing.headers.get('X-Frame-Options'), 'DENY');
  assert(missing.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  assert.equal((await f.call('/api/vault')).status, 403);
});
test('SEC-RL auth bursts receive Retry-After', async (t) => {
  const f = await fixture(t);
  f.advance(60000);
  const results = [];
  for (let i = 0; i < 6; i++)
    results.push(await f.call('/api/auth/prelogin', { userId: 'harper' }, { advance: false }));
  assert.equal(results[4].status, 200);
  assert.equal(results[5].status, 429);
  assert(results[5].headers.get('Retry-After'));
});

test('SEC-MIG freezes legacy writes and requires every encrypted readback before cutover', async (t) => {
  const f = await fixture(t, true),
    headers = await f.desktop();
  const old = { Origin: 'tauri://localhost', Cookie: '', Authorization: `Bearer ${f.legacyToken}` };
  assert.equal((await f.call('/api/sync/head', undefined, { headers })).status, 423);
  assert.equal((await f.call('/api/sync/versions/1', undefined, { headers: old })).status, 200);
  assert.equal((await f.call('/api/migration/start', {}, { headers })).status, 200);
  assert.equal(
    (
      await f.call(
        '/api/sync/head',
        { envelope: { ciphertext: 'changed' } },
        { method: 'PUT', headers: { ...old, 'If-Match': '"1"' } },
      )
    ).status,
    423,
  );
  assert.equal((await f.call('/api/migration/commit', {}, { headers })).status, 409);
  const e = envelope('snapshot', 'treasury', 1);
  assert.equal(
    (await f.call('/api/migration/versions/1', { envelope: e }, { method: 'PUT', headers })).status,
    200,
  );
  const readback = await f.call('/api/migration/versions/1', undefined, { headers });
  assert.deepEqual(readback.body.envelope, e);
  assert.equal(readback.body.createdAt, '2026-08-01T00:00:00.000Z');
  assert.equal(
    (await f.call('/api/migration/verify', { revision: 1, envelopeDigest: 'bad' }, { headers })).status,
    400,
  );
  const digest = createHash('sha256').update(JSON.stringify(e)).digest('base64url');
  assert.equal(
    (await f.call('/api/migration/verify', { revision: 1, envelopeDigest: digest }, { headers })).status,
    200,
  );
  assert.equal((await f.call('/api/migration/commit', {}, { headers })).status, 200);
  assert.equal((await f.call('/api/sync/head', undefined, { headers })).body.revision, 1);
  assert.equal((await f.call('/api/sync/head', undefined, { headers: old })).status, 401);
  assert.equal((await readdir(path.join(f.directory, 'versions'))).length, 1);
});
test('SEC-DEVICE desktop challenge requires the enrolled key and rejects replay', async (t) => {
  const f = await fixture(t),
    headers = await f.desktop();
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const registration = await f.call('/api/auth/devices', { publicKey }, { headers });
  assert.equal(registration.status, 200);
  f.advance(60000);
  const pending = await f.call(
    '/api/auth/login',
    { ...f.credentials, client: 'desktop' },
    { headers: { Origin: 'tauri://localhost', Cookie: '' } },
  );
  const opts = { headers: { Origin: 'tauri://localhost', Cookie: '' } };
  const challenge = await f.call('/api/auth/factor/device', { pending: pending.body.pending }, opts);
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Buffer.from(challenge.body.challenge, 'base64'),
    ),
  ).toString('base64');
  const body = { pending: pending.body.pending, method: 'device', deviceId: registration.body.id, signature };
  assert.equal((await f.call('/api/auth/factor', body, opts)).status, 200);
  assert.equal((await f.call('/api/auth/factor', body, opts)).status, 401);
});

test('SEC-SESS fresh step-up rotates cookies and recovery codes cannot authorize sensitive actions', async (t) => {
  const f = await fixture(t);
  await f.login();
  const oldCookie = f.cookie();
  f.advance(31000);
  const proof = await f.call('/api/auth/step-up', {
    method: 'totp',
    code: totp(f.secret, Math.floor((f.clock() + 7000) / 30000)),
  });
  assert.equal(proof.status, 200);
  assert.notEqual(f.cookie(), oldCookie);
  assert.equal(
    (await f.call('/api/auth/session', undefined, { headers: { Cookie: oldCookie } })).status,
    401,
  );
  assert.equal(
    (await f.call('/api/auth/step-up', { method: 'recovery', code: f.recoveryCodes[0] })).status,
    403,
  );
  assert.equal((await f.call('/api/auth/session')).status, 200);
});
test('SEC-MFA regenerating recovery codes invalidates every old code and stores only hashes', async (t) => {
  const f = await fixture(t);
  await f.login();
  const codes = await f.call('/api/auth/recovery/regenerate', {});
  assert.equal(codes.status, 200);
  assert.equal(codes.body.codes.length, 10);
  const disk = await readFile(path.join(f.directory, 'account.json'), 'utf8');
  for (const code of codes.body.codes) assert(!disk.includes(code));
  await f.call('/api/auth/logout', {});
  await f.call('/api/auth/login', f.credentials);
  assert.equal(
    (await f.call('/api/auth/factor', { method: 'recovery', code: f.recoveryCodes[0] })).status,
    401,
  );
  assert.equal(
    (await f.call('/api/auth/factor', { method: 'recovery', code: codes.body.codes[0] })).status,
    200,
  );
  assert.equal((await f.call('/api/auth/recovery/regenerate', {})).status, 403);
  await f.call('/api/auth/logout', {});
  await f.call('/api/auth/login', f.credentials);
  assert.equal(
    (await f.call('/api/auth/factor', { method: 'recovery', code: codes.body.codes[0] })).status,
    401,
  );
});
test('SEC-MFA authenticator replacement keeps old secret until confirmed, then ends other sessions', async (t) => {
  const f = await fixture(t);
  await f.login();
  const other = f.cookie();
  await f.login();
  const begin = await f.call('/api/auth/authenticator/begin', {});
  assert.equal(begin.status, 200);
  assert.equal((await f.call('/api/auth/authenticator/confirm', { code: 'bad' })).status, 401);
  assert.equal((await f.call('/api/auth/session', undefined, { headers: { Cookie: other } })).status, 200);
  const secret = fromBase32(begin.body.secret);
  const confirm = await f.call('/api/auth/authenticator/confirm', {
    code: totp(secret, Math.floor((f.clock() + 7000) / 30000)),
  });
  assert.equal(confirm.status, 200);
  assert.equal((await f.call('/api/auth/session', undefined, { headers: { Cookie: other } })).status, 401);
  await f.call('/api/auth/logout', {});
  f.advance(60000);
  await f.call('/api/auth/login', f.credentials);
  assert.equal(
    (
      await f.call('/api/auth/factor', {
        method: 'totp',
        code: totp(f.secret, Math.floor((f.clock() + 7000) / 30000)),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call('/api/auth/factor', {
        method: 'totp',
        code: totp(secret, Math.floor((f.clock() + 7000) / 30000)),
      })
    ).status,
    200,
  );
});
test('SEC-DEVICE revocation ends an enrolled desktop session and its device key cannot sign in again', async (t) => {
  const f = await fixture(t),
    desktop = await f.desktop();
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const device = await f.call('/api/auth/devices', { publicKey }, { headers: desktop });
  await f.login();
  assert.equal((await f.call('/api/auth/devices/revoke', { id: device.body.id })).status, 200);
  assert.equal((await f.call('/api/auth/session', undefined, { headers: desktop })).status, 401);
  const opts = { headers: { Origin: 'tauri://localhost', Cookie: '' } };
  const pending = await f.call('/api/auth/login', { ...f.credentials, client: 'desktop' }, opts);
  const challenge = await f.call('/api/auth/factor/device', { pending: pending.body.pending }, opts);
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Buffer.from(challenge.body.challenge, 'base64'),
    ),
  ).toString('base64');
  assert.equal(
    (
      await f.call(
        '/api/auth/factor',
        { pending: pending.body.pending, method: 'device', deviceId: device.body.id, signature },
        opts,
      )
    ).status,
    401,
  );
});
test('SEC-AUTH password changes require desktop and current password, preserve history and expire other sessions', async (t) => {
  const f = await fixture(t);
  await f.login();
  const oldCookie = f.cookie();
  const desktop = await f.desktop();
  const snapshot = envelope('snapshot', 'treasury', 1);
  await f.call(
    '/api/sync/head',
    { envelope: snapshot },
    { method: 'PUT', headers: { ...desktop, 'If-Match': '"0"' } },
  );
  const next = {
    ...f.credentials,
    authKey: randomBytes(32).toString('base64'),
    salt: randomBytes(32).toString('base64'),
    wrapped: { iv: 'new', ciphertext: 'new wrapper' },
  };
  assert.equal(
    (await f.call('/api/auth/password', { ...next, currentAuthKey: f.credentials.authKey })).status,
    403,
  );
  assert.equal(
    (await f.call('/api/auth/password', { ...next, currentAuthKey: 'wrong' }, { headers: desktop })).status,
    401,
  );
  assert.equal(
    (
      await f.call(
        '/api/auth/password',
        { ...next, currentAuthKey: f.credentials.authKey },
        { headers: desktop },
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call('/api/auth/session', undefined, { headers: { Cookie: oldCookie } })).status,
    401,
  );
  assert.deepEqual(
    (await f.call('/api/sync/versions/1', undefined, { headers: desktop })).body.envelope,
    snapshot,
  );
  assert.equal((await f.call('/api/auth/login', f.credentials)).status, 401);
  assert.equal((await f.call('/api/auth/login', next)).status, 200);
  f.advance(31000);
  assert.equal(
    (
      await f.call('/api/auth/factor', {
        method: 'totp',
        code: totp(f.secret, Math.floor((f.clock() + 7000) / 30000)),
      })
    ).status,
    200,
  );
});

test('SEC-RL only a signed desktop proof selects the trusted device lockout pool', async (t) => {
  const f = await fixture(t),
    headers = await f.desktop();
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const device = await f.call('/api/auth/devices', { publicKey }, { headers });
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await f.call('/api/auth/login', { ...f.credentials, authKey: 'wrong' }, { headers: { Cookie: '' } }))
        .status,
      401,
    );
  const opts = { headers: { Origin: 'tauri://localhost', Cookie: '' } };
  assert.equal(
    (await f.call('/api/auth/login', { ...f.credentials, client: 'desktop', deviceId: device.body.id }, opts))
      .status,
    429,
  );
  const challenge = await f.call('/api/auth/device/challenge', { deviceId: device.body.id }, opts);
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Buffer.from(challenge.body.challenge, 'base64'),
    ),
  ).toString('base64');
  const body = {
    ...f.credentials,
    client: 'desktop',
    deviceId: device.body.id,
    deviceProof: { challenge: challenge.body.challenge, signature },
  };
  assert.equal((await f.call('/api/auth/login', body, opts)).status, 200);
  assert.equal((await f.call('/api/auth/login', body, opts)).status, 429);
});

test('SEC-DEVICE desktop step-up binds password proof and signature, rotates bearer token and rejects replay', async (t) => {
  const f = await fixture(t),
    headers = await f.desktop(),
    pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const device = await f.call('/api/auth/devices', { publicKey }, { headers });
  assert.equal(
    (await f.call('/api/auth/step-up/device', { ...f.credentials, authKey: 'wrong' }, { headers })).status,
    401,
  );
  const challenge = await f.call('/api/auth/step-up/device', f.credentials, { headers });
  const signature = Buffer.from(
    await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Buffer.from(challenge.body.challenge, 'base64'),
    ),
  ).toString('base64');
  const body = { method: 'device', deviceId: device.body.id, signature };
  const proof = await f.call('/api/auth/step-up', body, { headers });
  assert.equal(proof.status, 200);
  const next = { ...headers, Authorization: `Bearer ${proof.body.token}` };
  assert.notEqual(next.Authorization, headers.Authorization);
  assert.equal((await f.call('/api/auth/session', undefined, { headers })).status, 401);
  assert.equal((await f.call('/api/auth/step-up', body, { headers: next })).status, 401);
  assert.equal((await f.call('/api/auth/session', undefined, { headers: next })).status, 200);
});

test('SEC-MFA break-glass requires the password, works once, replaces factors, and remains consumed after restart', async (t) => {
  const reset = randomBytes(32).toString('base64'),
    f = await fixture(t, false, { mfaReset: reset });
  assert.equal((await f.call('/api/auth/login', { ...f.credentials, authKey: 'wrong' })).status, 401);
  const login = await f.call('/api/auth/login', f.credentials);
  assert.equal(login.body.resetRequired, true);
  assert.equal((await f.call('/api/sync/head')).status, 401);
  const enrollment = await f.call('/api/auth/factor/reset/begin', {});
  assert.equal(enrollment.status, 200);
  assert.equal((await f.call('/api/auth/factor/reset/begin', {})).status, 403);
  const secret = fromBase32(enrollment.body.totpSecret);
  const confirmation = await f.call('/api/auth/factor/reset/confirm', {
    code: totp(secret, Math.floor((f.clock() + 7000) / 30000)),
  });
  assert.equal(confirmation.status, 200);
  assert.equal((await f.call('/api/auth/factor/reset/confirm', {})).status, 401);
  const state = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert(state.events.some((e) => e.type === 'mfa_break_glass_completed'));
  assert(!JSON.stringify(state).includes(reset));
  await new Promise((resolve) => f.server.close(resolve));
  const server = await createV3Server({ ...f.config, mfaReset: reset, now: f.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PT-Request': '1', Origin: 'http://localhost' },
    body: JSON.stringify(f.credentials),
  });
  assert.equal((await response.json()).resetRequired, false);
});
test('SEC-KEY at-rest rotation rewrites only encrypted account fields and requires the old key', async (t) => {
  const f = await fixture(t),
    before = JSON.parse(await readFile(path.join(f.directory, 'account.json'), 'utf8'));
  await new Promise((resolve) => f.server.close(resolve));
  const nextKey = randomBytes(32).toString('base64');
  await assert.rejects(
    createV3Server({ ...f.config, atRestKeyId: '2', atRestKey: nextKey }),
    /Required at-rest key/,
  );
  const server = await createV3Server({
    ...f.config,
    atRestKeyId: '2',
    atRestKey: f.config.atRestKey,
    atRestKeys: { 1: f.config.atRestKey, 2: nextKey },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const after = JSON.parse(await readFile(path.join(f.directory, 'account.json'), 'utf8'));
  assert.equal(after.wrapped.kid, '2');
  assert.equal(after.totp.kid, '2');
  assert.notEqual(after.wrapped.ciphertext, before.wrapped.ciphertext);
  assert.equal(after.verifier, before.verifier);
  assert(!JSON.stringify(after).includes('wrapped key canary'));
  // Reopening with only the new key proves both account fields were rewrapped atomically.
  const reopened = await createV3Server({ ...f.config, atRestKeyId: '2', atRestKey: nextKey });
  t.after(() => new Promise((resolve) => reopened.close(resolve)));
});

test('SEC-LOG request templates and append-only security events omit credential and path canaries', async (t) => {
  const logs = [],
    f = await fixture(t, false, { requestLogger: (r) => logs.push(r) });
  await f.login();
  await f.call('/api/auth/prelogin?CANARY_QUERY', { userId: 'CANARY_USER_ID' });
  await f.call('/api/CANARY_PATH', {});
  const files = await readdir(path.join(f.directory, 'security-events'));
  const journal = (
    await Promise.all(files.map((name) => readFile(path.join(f.directory, 'security-events', name), 'utf8')))
  ).join('');
  assert.match(journal, /sign_in_succeeded/);
  assert.match(journal, /browser/);
  const raw = JSON.stringify(logs) + journal;
  for (const canary of [
    'CANARY_QUERY',
    'CANARY_PATH',
    'CANARY_USER_ID',
    f.credentials.authKey,
    f.cookie(),
    f.secret,
    f.credentials.userId,
  ])
    assert.equal(raw.includes(canary), false);
  assert.ok(
    logs.every(
      (r) => r.requestId && r.ipTag && Number.isInteger(r.inputBytes) && Number.isInteger(r.outputBytes),
    ),
  );
  assert.equal(logs.at(-1).route, 'unmatched_api');
});
test('SEC-RL proxy IP partitioning is opt-in and never uses X-Forwarded-For', async (t) => {
  const direct = await fixture(t);
  direct.advance(30000);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await direct.call(
          '/api/auth/prelogin',
          {},
          { advance: false, headers: { 'X-Real-IP': `192.0.2.${i + 1}` } },
        )
      ).status,
      200,
    );
  assert.equal(
    (await direct.call('/api/auth/prelogin', {}, { advance: false, headers: { 'X-Real-IP': '192.0.2.99' } }))
      .status,
    429,
  );
  const proxied = await fixture(t, false, { trustProxy: true });
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await proxied.call(
          '/api/auth/prelogin',
          {},
          { advance: false, headers: { 'X-Real-IP': '192.0.2.1' } },
        )
      ).status,
      200,
    );
  assert.equal(
    (
      await proxied.call(
        '/api/auth/prelogin',
        {},
        { advance: false, headers: { 'X-Real-IP': '192.0.2.1', 'X-Forwarded-For': '192.0.2.99' } },
      )
    ).status,
    429,
  );
  assert.equal(
    (await proxied.call('/api/auth/prelogin', {}, { advance: false, headers: { 'X-Real-IP': '192.0.2.2' } }))
      .status,
    200,
  );
});
test('SEC-RL the persisted hourly breaker closes untrusted sign-ins while a signed trusted browser can still complete password proof', async (t) => {
  const f = await fixture(t);
  await f.login();
  await new Promise((resolve) => f.server.close(resolve));
  const stateFile = path.join(f.directory, 'state.json'),
    state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.hourFailures = Array(1000).fill(f.clock());
  await writeFile(stateFile, JSON.stringify(state));
  const server = await createV3Server({ ...f.config, now: f.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = async (body, cookie = '') => {
    f.advance(7000);
    return fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        'X-PT-Request': '1',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  };
  assert.equal((await call({ ...f.credentials, authKey: randomBytes(32).toString('base64') })).status, 401);
  assert.equal((await call(f.credentials)).status, 429);
  assert.equal((await call(f.credentials, f.cookie())).status, 200);
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.ok(persisted.breakerUntil > f.clock());
});

test('SEC-MIG expired proof leaves legacy history untouched and fresh desktop sign-in resumes migration', async (t) => {
  const f = await fixture(t, true);
  const stale = await f.desktop();
  const original = await readFile(path.join(f.directory, 'versions', '1.json'), 'utf8');
  f.advance(301000);
  const blocked = await f.call('/api/migration/start', {}, { headers: stale });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'step_up_required');
  assert.equal(
    (await f.call('/api/migration/status', undefined, { headers: stale })).body.phase,
    'not_started',
  );
  assert.equal(await readFile(path.join(f.directory, 'versions', '1.json'), 'utf8'), original);
  await f.call('/api/auth/logout', {}, { headers: stale });
  assert.equal((await f.call('/api/migration/status', undefined, { headers: stale })).status, 401);
  const fresh = await f.desktop();
  assert.equal((await f.call('/api/migration/start', {}, { headers: fresh })).status, 200);
  assert.equal((await f.call('/api/migration/status', undefined, { headers: fresh })).body.phase, 'copying');
  assert.equal(await readFile(path.join(f.directory, 'versions', '1.json'), 'utf8'), original);
});

async function upload(f, url, { method = 'PUT', headers = {}, prefix, length } = {}) {
  const { request } = await import('node:http');
  let req;
  const response = new Promise((resolve, reject) => {
    req = request(
      {
        hostname: '127.0.0.1',
        port: f.server.address().port,
        path: url,
        method,
        headers: {
          Origin: 'http://localhost',
          'X-PT-Request': '1',
          'Content-Type': 'application/json',
          Cookie: f.cookie(),
          ...(length === undefined ? {} : { 'Content-Length': length }),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (part) => {
          body += part;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {}, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
  });
  const admitted = new Promise((resolve) => req.once('continue', resolve));
  req.flushHeaders();
  if (prefix) req.write(prefix);
  return { req, response, admitted };
}

test('T-01 protected and unknown uploads reject before JSON/body ingestion, including Expect continue', async (t) => {
  const logs = [];
  const f = await fixture(t, false, { requestLogger: (r) => logs.push(r) });
  for (const [url, method, headers, status] of [
    ['/api/sync/head', 'PUT', { Cookie: '' }, 401],
    ['/api/vault', 'PUT', { Cookie: '' }, 401],
    ['/api/unknown', 'POST', {}, 404],
    ['/api/auth/factor/unknown', 'POST', {}, 404],
    ['/api/auth/login', 'PUT', {}, 404],
    ['/api/setup/begin', 'POST', {}, 404],
    ['/api/sync/head', 'PUT', { Cookie: '', Expect: '100-continue' }, 401],
  ]) {
    const u = await upload(f, url, { method, headers, length: 32 * 1024 ** 2 });
    let continued = false;
    u.req.on('continue', () => {
      continued = true;
    });
    const result = await u.response; // never send body or end: must receive prompt final response
    assert.equal(result.status, status);
    assert.equal(continued, false);
    assert.equal(logs.at(-1).inputBytes, 0);
    assert.equal(result.headers.connection, 'close');
    u.req.destroy();
  }
});

test('T-01 streaming caps and declared limits reject promptly and capacity recovers after invalid JSON and abort', async (t) => {
  const f = await fixture(t);
  await f.login();
  for (const [url, method, cap] of [
    ['/api/sync/head', 'PUT', 32 * 1024 ** 2],
    ['/api/review/11111111-1111-4111-8111-111111111111', 'PUT', 8 * 1024 ** 2],
    ['/api/auth/passkeys/verify', 'POST', 256 * 1024],
    ['/api/auth/sessions/revoke', 'POST', 64 * 1024],
  ]) {
    const u = await upload(f, url, { method, length: cap + 1 });
    assert.equal((await u.response).status, 413);
    u.req.destroy();
  }
  const large = await upload(f, '/api/auth/sessions/revoke', {
    method: 'POST',
    prefix: ' '.repeat(64 * 1024 + 1),
  });
  assert.equal((await large.response).status, 413);
  large.req.destroy();
  const invalid = await upload(f, '/api/sync/head', { prefix: '{' });
  invalid.req.end();
  assert.equal((await invalid.response).body.error, 'invalid_json');
  const aborted = await upload(f, '/api/sync/head', { prefix: '{"envelope":' });
  aborted.response.catch(() => {});
  aborted.req.destroy();
  // Subsequent requests must be able to reserve a full snapshot slot.
  assert.equal(
    (
      await f.call(
        '/api/sync/head',
        { envelope: envelope('snapshot', 'treasury', 1) },
        { method: 'PUT', headers: { 'If-Match': '"0"' } },
      )
    ).status,
    200,
  );
});

test('T-01 aggregate reservations reject overload without waiting and recover on disconnect', async (t) => {
  const f = await fixture(t);
  await f.login();
  const a = await upload(f, '/api/sync/head', { prefix: '{', headers: { Expect: '100-continue' } });
  await a.admitted;
  const b = await upload(f, '/api/sync/head', { prefix: '{', headers: { Expect: '100-continue' } });
  await b.admitted;
  a.response.catch(() => {});
  b.response.catch(() => {});
  const busy = await upload(f, '/api/sync/head');
  const response = await busy.response;
  assert.equal(response.status, 503);
  assert.equal(response.headers['retry-after'], '1');
  busy.req.destroy();
  a.req.end();
  b.req.end();
  assert.equal((await a.response).status, 400);
  assert.equal((await b.response).status, 400);
  const next = await upload(f, '/api/sync/head', { prefix: '{}' });
  next.req.end();
  assert.equal((await next.response).status, 409); // reaches conditional write check
});

test('T-01 slow ingestion revalidates logout, lock, absolute expiry and fresh proof before writes', async (t) => {
  for (const invalidation of ['logout', 'lock', 'expiry', 'step-up']) {
    const f = await fixture(t);
    await f.login();
    const sensitive = invalidation === 'step-up';
    const u = await upload(f, sensitive ? '/api/sync/pin' : '/api/sync/head', {
      method: sensitive ? 'POST' : 'PUT',
      prefix: sensitive ? '{"revision":' : '{"envelope":',
      headers: { 'If-Match': '"0"' },
    });
    // A completed read is a deterministic barrier that the partial body was admitted.
    assert.equal((await f.call('/api/sync/head')).status, 200);
    if (invalidation === 'expiry') f.advance(12 * 3600000);
    else if (invalidation === 'step-up') f.advance(5 * 60000);
    else await f.call('/api/auth/' + invalidation, {});
    u.req.end(sensitive ? '1}' : JSON.stringify(envelope('snapshot', 'treasury', 1)) + '}');
    const result = await u.response;
    assert.equal(result.status, sensitive ? 403 : 401);
    assert.equal(
      result.body.error,
      sensitive ? 'step_up_required' : invalidation === 'lock' ? 'locked' : 'expired',
    );
    assert.equal((await readdir(path.join(f.directory, 'snapshots'))).length, 0);
  }
});

test('T-01 early and queued session refusals preserve serialized lock and expiry audit events', async (t) => {
  const f = await fixture(t);
  await f.login();
  f.advance(15 * 60000);
  assert.equal((await f.call('/api/sync/head')).body.error, 'locked');
  assert.equal((await f.call('/api/auth/session')).body.locked, true);
  const events = async () => await readFile(path.join(f.directory, 'state.json'), 'utf8');
  assert.match(await events(), /"type":"locked"/);
  await f.call('/api/auth/unlock', f.credentials);
  const u = await upload(f, '/api/sync/head', { prefix: '{"envelope":' });
  assert.equal((await f.call('/api/sync/head')).status, 200);
  f.advance(12 * 3600000);
  u.req.end(JSON.stringify(envelope('snapshot', 'treasury', 1)) + '}');
  assert.equal((await u.response).body.error, 'expired');
  assert.match(await events(), /"type":"session_expired"/);
  const before = await events();
  assert.equal((await f.call('/api/sync/head')).body.error, 'expired');
  assert.equal(await events(), before); // expired session removed; event emitted once
});

test('T-01 legitimate near-cap encrypted snapshot, review, vault and migration round-trip without truncation', async (t) => {
  const { createCipheriv, createDecipheriv } = await import('node:crypto');
  const f = await fixture(t, true);
  const headers = await f.desktop();
  const key = randomBytes(32);
  const encrypted = (purpose, ref, rev, cap) => {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    // Base64 expands binary 4/3; leave room for JSON and the authentication tag.
    const plain = Buffer.alloc(Math.floor(((cap - 4096) * 3) / 4), 0x61);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString(
      'base64',
    );
    return { ...envelope(purpose, ref, rev), iv: iv.toString('base64'), ciphertext };
  };
  const verify = (value, expected) => {
    assert.deepEqual(value, expected);
    const bytes = Buffer.from(value.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(bytes.subarray(-16));
    const plain = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
    assert.equal(plain[0], 0x61);
    assert.equal(plain.at(-1), 0x61);
  };
  assert.equal((await f.call('/api/migration/start', {}, { headers })).status, 200);
  let value = encrypted('snapshot', 'treasury', 1, 32 * 1024 ** 2);
  let body = { envelope: value };
  assert(Buffer.byteLength(JSON.stringify(body)) < 32 * 1024 ** 2);
  assert.equal((await f.call('/api/migration/versions/1', body, { method: 'PUT', headers })).status, 200);
  verify((await f.call('/api/migration/versions/1', undefined, { headers })).body.envelope, value);
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('base64url');
  assert.equal(
    (await f.call('/api/migration/verify', { revision: 1, envelopeDigest: digest }, { headers })).status,
    200,
  );
  assert.equal((await f.call('/api/migration/commit', {}, { headers })).status, 200);
  value = encrypted('snapshot', 'treasury', 2, 32 * 1024 ** 2);
  body = { envelope: value };
  assert.equal(
    (await f.call('/api/sync/head', body, { method: 'PUT', headers: { ...headers, 'If-Match': '"1"' } }))
      .status,
    200,
  );
  verify((await f.call('/api/sync/versions/2', undefined, { headers })).body.envelope, value);
  const ref = '11111111-1111-4111-8111-111111111111';
  value = encrypted('review', ref, 1, 8 * 1024 ** 2);
  body = { envelope: value, header: envelope('review-header', ref, 1) };
  assert.equal(
    (await f.call('/api/review/' + ref, body, { method: 'PUT', headers: { ...headers, 'If-Match': '"0"' } }))
      .status,
    200,
  );
  verify((await f.call('/api/review/' + ref, undefined, { headers })).body.envelope, value);
  value = encrypted('vault', 'credentials', 1, 1024 ** 2);
  assert.equal(
    (
      await f.call(
        '/api/vault',
        { envelope: value },
        { method: 'PUT', headers: { ...headers, 'If-Match': '"0"' } },
      )
    ).status,
    200,
  );
  verify((await f.call('/api/vault', undefined, { headers })).body.envelope, value);
});

test(
  'T-01 intake deadline frees aggregate capacity without a client end or disconnect',
  { timeout: 40000 },
  async (t) => {
    const f = await fixture(t);
    await f.login();
    const a = await upload(f, '/api/sync/head', { prefix: '{', headers: { Expect: '100-continue' } });
    await a.admitted;
    const b = await upload(f, '/api/sync/head', { prefix: '{', headers: { Expect: '100-continue' } });
    await b.admitted;
    assert.equal((await f.call('/api/sync/head', {}, { method: 'PUT' })).status, 503);
    assert.deepEqual(
      (await Promise.all([a.response, b.response])).map((r) => r.status),
      [408, 408],
    );
    a.req.destroy();
    b.req.destroy();
    assert.equal((await f.call('/api/sync/head', {}, { method: 'PUT' })).status, 409);
  },
);

test(
  'T-01 queued parsed bodies retain reservations and bounded readers do not create an unbounded queue',
  { skip: process.platform === 'win32' },
  async (t) => {
    const { execFileSync } = await import('node:child_process');
    const { open, unlink } = await import('node:fs/promises');
    const f = await fixture(t);
    await f.login();
    const ref = '11111111-1111-4111-8111-111111111111';
    const fifo = path.join(f.directory, 'reviews', ref + '.json');
    execFileSync('mkfifo', [fifo]);
    // A disposable FIFO read holds the serialized lane, not the upload reader.
    const blocked = f.call('/api/review/' + ref);
    const writer = await open(fifo, 'w'); // reader has entered route(); lane is now blocked
    const uploads = [],
      reads = [];
    try {
      for (let i = 0; i < 2; i++) {
        const u = await upload(f, '/api/sync/head', { headers: { Expect: '100-continue' }, prefix: '{}' });
        await u.admitted;
        u.req.end();
        uploads.push(u);
      }
      const busy = await upload(f, '/api/sync/head');
      assert.equal((await busy.response).status, 503);
      busy.req.destroy();
      // Two parsed uploads plus the blocked route consume three of sixteen slots.
      for (let i = 0; i < 13; i++) {
        const r = await upload(f, '/api/sync/head', {
          method: 'GET',
          length: 0,
          headers: { Expect: '100-continue' },
        });
        await r.admitted;
        r.req.end();
        reads.push(r);
      }
      const full = await upload(f, '/api/sync/head', { method: 'GET' });
      assert.equal((await full.response).status, 503);
      full.req.destroy();
    } finally {
      await writer.write(JSON.stringify({ expiresAt: '2099-01-01T00:00:00Z' }));
      await writer.close();
    }
    assert.equal((await blocked).status, 200);
    assert.deepEqual(
      (await Promise.all(uploads.map((u) => u.response))).map((r) => r.status),
      [409, 409],
    );
    assert((await Promise.all(reads.map((r) => r.response))).every((r) => r.status === 200));
    await unlink(fifo);
    assert.equal((await f.call('/api/sync/head')).status, 200);
  },
);

test('T-01 enrollment secret is checked before the first body is consumed', async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(path.join(tmpdir(), 'pt-v3-unenrolled-'));
  const server = await createV3Server({ ...f.config, dataDirectory: directory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const unenrolled = { server, cookie: () => '' };
  const u = await upload(unenrolled, '/api/setup/begin', {
    method: 'POST',
    headers: { Origin: 'tauri://localhost', Authorization: 'Bearer invalid' },
    length: 1024 ** 2,
  });
  assert.equal((await u.response).status, 401);
  u.req.destroy();
});
