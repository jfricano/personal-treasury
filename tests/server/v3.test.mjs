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
async function fixture(t, legacy = false) {
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
      now: () => clock,
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
