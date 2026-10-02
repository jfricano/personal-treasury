import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const suffix = randomBytes(6).toString('hex'),
  name = `pt-v3-smoke-${suffix}`,
  volume = `${name}-data`,
  image = 'pt-v3-private-smoke';
function code(secret, step) {
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const c of secret) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
execFileSync('docker', ['build', '-f', 'sync-server/Dockerfile', '-t', image, '.'], { stdio: 'inherit' });
const setup = randomBytes(32).toString('base64url'),
  authKey = randomBytes(32).toString('base64');
const env = {
  PT_AUTH_PEPPER: randomBytes(32).toString('base64'),
  PT_AT_REST_KEY: randomBytes(32).toString('base64'),
  PT_DEVICE_COOKIE_KEY: randomBytes(32).toString('base64'),
  PT_LOG_KEY: randomBytes(32).toString('base64'),
  PT_SETUP_SECRET: setup,
  PT_PUBLIC_ORIGIN: 'http://localhost',
};
let cookies = '';
try {
  docker('volume', 'create', volume);
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::8787',
    '-v',
    `${volume}:/data`,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    image,
  );
  const address = () => `http://127.0.0.1:${docker('port', name, '8787/tcp').split(':').at(-1)}`;
  let base = address();
  const ready = async () => {
    for (let i = 0; i < 30; i++) {
      try {
        if ((await fetch(base + '/healthz')).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Private container did not become ready');
  };
  await ready();
  assert.match(await (await fetch(base)).text(), /Personal Treasury/);
  assert.equal((await fetch(base + '/api/sync/head')).status, 401);
  const call = async (route, body, headers = {}, method = 'POST') => {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        'X-PT-Request': '1',
        Cookie: cookies,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(';')[0],
        key = part.split('=')[0];
      cookies = cookies
        .split('; ')
        .filter((v) => !v.startsWith(key + '='))
        .concat(part)
        .filter(Boolean)
        .join('; ');
    }
    const result = await response.json();
    assert.equal(response.ok, true, `${route}: ${result.error}`);
    return result;
  };
  const credentials = {
    userId: 'container-fixture',
    authKey,
    salt: randomBytes(32).toString('base64'),
    params: { m: 65536, t: 3, p: 1 },
    kid: '1',
    wrapped: { iv: 'synthetic', ciphertext: 'synthetic wrapped key' },
  };
  const setupHeaders = { Authorization: `Bearer ${setup}`, Origin: 'tauri://localhost' };
  const enrollment = await call('/api/setup/begin', credentials, setupHeaders);
  await call(
    '/api/setup/confirm',
    { enrollment: enrollment.enrollment, code: code(enrollment.totpSecret, Math.floor(Date.now() / 30000)) },
    setupHeaders,
  );
  await call('/api/auth/login', credentials);
  await call('/api/auth/factor', { method: 'recovery', code: enrollment.recoveryCodes[0] });
  await call(
    '/api/sync/head',
    {
      envelope: {
        v: 2,
        purpose: 'snapshot',
        ref: 'treasury',
        rev: 1,
        kid: '1',
        nonce: 'synthetic',
        iv: 'synthetic',
        ciphertext: 'synthetic encrypted fixture',
      },
    },
    { 'If-Match': '"0"' },
    'PUT',
  );
  const controls = JSON.parse(
    docker(
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      `import fs from 'node:fs'; const command=fs.readFileSync('/proc/1/cmdline','utf8'); let writable=false; try {fs.writeFileSync('/app/forbidden-write','fixture'); writable=true;} catch {} console.log(JSON.stringify({uid:process.getuid(),permission:command.includes('--permission'),writable,npm:fs.existsSync('/usr/local/bin/npm'),npx:fs.existsSync('/usr/local/bin/npx')}));`,
    ),
  );
  assert.notEqual(controls.uid, 0);
  assert.equal(controls.permission, true);
  assert.equal(controls.writable, false);
  assert.equal(controls.npm, false);
  assert.equal(controls.npx, false);
  docker('restart', name);
  base = address();
  await ready();
  cookies = '';
  await call('/api/auth/login', credentials);
  await call('/api/auth/factor', { method: 'recovery', code: enrollment.recoveryCodes[1] });
  assert.equal((await call('/api/sync/head', null, {}, 'GET')).revision, 1);
  const logs = docker('logs', name);
  for (const secret of [setup, authKey, ...Object.values(env).filter((v) => v !== env.PT_PUBLIC_ORIGIN)])
    assert.equal(logs.includes(secret), false);
  console.log(
    'Private container smoke passed: MFA, persistent restart, anonymous rejection, non-root runtime, immutable app, Node permissions and sanitized logs.',
  );
} finally {
  try {
    docker('rm', '-f', name);
  } catch {}
  try {
    docker('volume', 'rm', volume);
  } catch {}
}
