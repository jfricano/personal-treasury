/** Disposable fictional private service. Never point this at an existing data directory. */
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import initSqlJs from 'sql.js';
import { createV3Server, totp } from '../sync-server/v3.mjs';
const port = Number(process.env.PT_FIXTURE_PORT ?? 8788),
  origin = `http://localhost:${port}`;
const directory = await mkdtemp(path.join(tmpdir(), 'pt-v3-fictional-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', mode: 'demo' });
const crypto = await vite.ssrLoadModule('/src/security/crypto.ts');
const { buildSampleDatabase } = await vite.ssrLoadModule('/src/demo/seed.ts');
const SQL = await initSqlJs({ locateFile: () => path.resolve('node_modules/sql.js/dist/sql-wasm.wasm') });
const bytes = await buildSampleDatabase(SQL);
const id = 'harper',
  password = 'Fictional treasury review 2026!',
  salt = crypto.base64(crypto.random()),
  keys = await crypto.derivePasswordKeys(password, salt, crypto.DEFAULT_KDF),
  raw = crypto.random(),
  dataKey = await crypto.importDataKey(raw),
  wrapped = await crypto.wrapDataKey(keys.wrapKey, raw, id, '1');
raw.fill(0);
await vite.close();
const setupSecret = randomBytes(32).toString('base64url');
const config = Object.fromEntries(
  ['pepper', 'atRestKey', 'deviceCookieKey', 'logKey'].map((key) => [
    key,
    randomBytes(32).toString('base64'),
  ]),
);
let server = await createV3Server({
  dataDirectory: directory,
  staticDirectory: path.resolve('dist-private'),
  origin,
  ...config,
  setupSecret,
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
async function request(route, value, token, method = 'POST', revision) {
  const response = await fetch(`${origin}${route}`, {
    method,
    headers: {
      Origin: 'tauri://localhost',
      'Content-Type': 'application/json',
      'X-PT-Request': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
    },
    body: JSON.stringify(value),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${route}: ${body.error}`);
  return body;
}
const credentials = {
  userId: id,
  authKey: keys.authKey,
  salt,
  params: crypto.DEFAULT_KDF,
  kid: '1',
  wrapped,
};
const enrollment = await request('/api/setup/begin', credentials, setupSecret);
function decode(s) {
  let bits = 0,
    value = 0;
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
await request(
  '/api/setup/confirm',
  {
    enrollment: enrollment.enrollment,
    code: totp(decode(enrollment.totpSecret), Math.floor(Date.now() / 30000)),
  },
  setupSecret,
);
const pending = await request('/api/auth/login', { ...credentials, client: 'desktop' });
const login = await request('/api/auth/factor', {
  pending: pending.pending,
  method: 'recovery',
  code: enrollment.recoveryCodes[0],
});
const envelope = await crypto.encryptObject(dataKey, bytes, { purpose: 'snapshot', ref: 'treasury', rev: 1 });
await request('/api/sync/head', { envelope }, login.token, 'PUT', 0);
await new Promise((resolve) => server.close(resolve));
server = await createV3Server({
  dataDirectory: directory,
  staticDirectory: path.resolve('dist-private'),
  origin,
  ...config,
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const access = {
  origin,
  userId: id,
  password,
  totpSecret: enrollment.totpSecret,
  recoveryCodes: enrollment.recoveryCodes.slice(1),
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/v3-access.json', JSON.stringify(access), { mode: 0o600 });
console.log(
  `Fictional private v3 preview: ${origin}\nUser ID: ${id}\nPassword: ${password}\nChoose Recovery code: ${access.recoveryCodes[0]}\nFixture access details: test-results/v3-access.json`,
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
