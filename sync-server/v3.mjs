import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rename,
  readdir,
  stat,
  unlink,
  realpath,
  rm,
} from 'node:fs/promises';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  webcrypto,
} from 'node:crypto';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const DAY = 86400000;
const logRoutes = new Set([
  '/api/auth/activity',
  '/api/auth/authenticator/begin',
  '/api/auth/authenticator/confirm',
  '/api/auth/device/challenge',
  '/api/auth/devices',
  '/api/auth/devices/revoke',
  '/api/auth/factor/device',
  '/api/auth/factor/options',
  '/api/auth/factor/reset/begin',
  '/api/auth/factor/reset/confirm',
  '/api/auth/lock',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/logout-all',
  '/api/auth/passkeys',
  '/api/auth/passkeys/options',
  '/api/auth/passkeys/revoke',
  '/api/auth/passkeys/verify',
  '/api/auth/password',
  '/api/auth/password/key',
  '/api/auth/prelogin',
  '/api/auth/recovery/regenerate',
  '/api/auth/session',
  '/api/auth/sessions',
  '/api/auth/sessions/revoke',
  '/api/auth/step-up',
  '/api/auth/step-up/device',
  '/api/auth/step-up/options',
  '/api/auth/unlock',
  '/api/migration/cancel',
  '/api/migration/commit',
  '/api/migration/delete-legacy',
  '/api/migration/start',
  '/api/migration/status',
  '/api/migration/verify',
  '/api/review',
  '/api/setup/begin',
  '/api/setup/confirm',
  '/api/sync/head',
  '/api/sync/pin',
  '/api/sync/prune',
  '/api/sync/versions',
  '/api/vault',
  '/healthz',
]);
function logRoute(pathname) {
  if (logRoutes.has(pathname)) return pathname;
  if (/^\/api\/review\/[^/]+$/.test(pathname)) return '/api/review/:ref';
  if (/^\/api\/migration\/versions\/\d+$/.test(pathname)) return '/api/migration/versions/:revision';
  if (/^\/api\/sync\/versions\/\d+$/.test(pathname)) return '/api/sync/versions/:revision';
  return pathname.startsWith('/api/') ? 'unmatched_api' : 'static';
}

const hash = (v) => createHash('sha256').update(v).digest('base64url');
const equal = (a, b) =>
  timingSafeEqual(
    createHash('sha256').update(String(a)).digest(),
    createHash('sha256').update(String(b)).digest(),
  );
const normalizeId = (v) =>
  String(v ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
export function totp(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', Buffer.from(secret, 'base64')).update(counter).digest();
  const offset = mac[19] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0,
    out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function seal(key, value) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
function open(key, value) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  d.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(value.ciphertext, 'base64')), d.final()]).toString());
}
async function atomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}
async function read(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
class HttpError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
  }
}
const reject = (status, error) => {
  throw new HttpError(status, error);
};
const bodyObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function validEnvelope(e, purpose, ref, rev) {
  return (
    bodyObject(e) &&
    e.v === 2 &&
    e.purpose === purpose &&
    e.ref === ref &&
    e.rev === rev &&
    typeof e.kid === 'string' &&
    typeof e.nonce === 'string' &&
    typeof e.iv === 'string' &&
    typeof e.ciphertext === 'string' &&
    e.ciphertext.length > 0
  );
}
function validKeys(b) {
  return (
    /^[A-Za-z0-9+/]{43}=$/.test(b.authKey ?? '') &&
    /^[A-Za-z0-9+/]{43}=$/.test(b.salt ?? '') &&
    b.params?.m >= 47104 &&
    b.params.m <= 262144 &&
    Number.isInteger(b.params.m) &&
    b.params.t >= 1 &&
    b.params.t <= 10 &&
    Number.isInteger(b.params.t) &&
    b.params.p === 1 &&
    bodyObject(b.wrapped) &&
    typeof b.wrapped.iv === 'string' &&
    typeof b.wrapped.ciphertext === 'string' &&
    typeof b.kid === 'string'
  );
}
export function securityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
  );
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; font-src 'self'; manifest-src 'self'; frame-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; style-src-attr 'none'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types pt-worker",
  );
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
function cookie(req, name) {
  return String(req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
const cookieValue = (name, value, expiry = '') =>
  `${name}=${value}; Secure; HttpOnly; SameSite=Strict; Path=/${expiry}`;

export async function createV3Server({
  dataDirectory,
  staticDirectory,
  origin,
  pepper,
  atRestKey,
  atRestKeyId = '1',
  atRestKeys = {},
  mfaReset,
  deviceCookieKey,
  logKey,
  setupSecret,
  legacyToken,
  trustProxy = false,
  requestLogger = (record) => console.log(JSON.stringify(record)),
  now = () => Date.now(),
} = {}) {
  if (!dataDirectory || !origin) throw new Error('V3 needs a data directory and public origin');
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(publicUrl.hostname))
    throw new Error('Private origin must use HTTPS');
  atRestKey = atRestKeys[atRestKeyId] ?? atRestKey;
  const keys = { pepper, atRestKey, deviceCookieKey, logKey };
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(atRestKeyId)) throw new Error('Invalid at-rest key ID');
  const keyRing = { ...atRestKeys, [atRestKeyId]: atRestKey };
  for (const value of Object.values(keyRing))
    if (!value || Buffer.from(value, 'base64').length !== 32)
      throw new Error('Every at-rest key must contain 32 bytes');
  if (mfaReset && String(mfaReset).length < 32)
    throw new Error('MFA reset requires a random value of at least 32 characters');
  for (const [name, value] of Object.entries(keys))
    if (!value || Buffer.from(value, 'base64').length !== 32)
      throw new Error(`${name} must be 32 random bytes in base64`);
  const rest = Buffer.from(atRestKey, 'base64'),
    mac = (label, value) =>
      createHmac('sha256', Buffer.from(keys[label], 'base64')).update(String(value)).digest('base64');
  const sealRest = (value) => ({ ...seal(rest, value), kid: atRestKeyId });
  const openRest = (value) => {
    const encodedKey = keyRing[value.kid ?? '1'];
    if (!encodedKey) throw new Error('Required at-rest key is missing');
    return open(Buffer.from(encodedKey, 'base64'), value);
  };
  const origins = new Set([origin, 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  for (const folder of ['snapshots', 'reviews', 'quarantine', 'security-events'])
    await mkdir(path.join(dataDirectory, folder), { recursive: true, mode: 0o700 });
  const accountFile = path.join(dataDirectory, 'account.json'),
    stateFile = path.join(dataDirectory, 'state.json');
  let account = await read(accountFile, null),
    state = await read(stateFile, {
      failures: 0,
      lockedUntil: 0,
      closed: false,
      trusted: {},
      events: [],
      tombstones: {},
      head: 0,
      pinned: [],
      pruned: {},
    });
  if (account && [account.wrapped, account.totp].some((v) => v.kid !== atRestKeyId)) {
    const wrapped = openRest(account.wrapped),
      secret = openRest(account.totp);
    account = { ...account, wrapped: sealRest(wrapped), totp: sealRest(secret) };
    await atomic(accountFile, account);
  }
  const legacyNames = (await readdir(path.join(dataDirectory, 'versions')).catch(() => [])).filter((n) =>
    /^[1-9]\d*\.json$/.test(n),
  );
  if (legacyNames.length && !legacyToken && state.migration?.phase !== 'committed')
    throw new Error('Existing v2.2 history requires PT_SYNC_TOKEN for migration.');
  let legacyServer = null;
  if (legacyToken && state.migration?.phase !== 'committed') {
    const { createSyncServer } = await import('./server.mjs');
    legacyServer = await createSyncServer({
      token: legacyToken,
      dataDirectory,
      allowedOrigins: [...origins].join(','),
    });
  }
  setupSecret ??= legacyToken;
  const sessions = new Map(),
    pending = new Map(),
    enrollments = new Map(),
    deviceProofs = new Map(),
    rates = new Map();
  let queue = Promise.resolve();
  const saveAccount = () => atomic(accountFile, account),
    saveState = () => atomic(stateFile, state);
  const purgeSecurityLogs = async () => {
    for (const name of await readdir(path.join(dataDirectory, 'security-events'))) {
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && Date.parse(name.slice(0, 10)) + DAY < now() - 400 * DAY)
        await unlink(path.join(dataDirectory, 'security-events', name));
    }
  };
  await purgeSecurityLogs();
  const event = async (type, device) => {
    const record = { time: new Date(now()).toISOString(), type, ...(device ? { device } : {}) };
    await appendFile(
      path.join(dataDirectory, 'security-events', `${record.time.slice(0, 10)}.jsonl`),
      JSON.stringify(record) + '\n',
      { mode: 0o600 },
    );
    state.events.push(record);
    state.events = state.events.filter((e) => Date.parse(e.time) > now() - 400 * DAY).slice(-10000);
    await saveState();
  };
  const verifier = (key) => mac('pepper', key);
  const verifyPassword = (b) => {
    const expected = account?.verifier ?? mac('pepper', 'dummy');
    const matched = equal(verifier(typeof b.authKey === 'string' ? b.authKey : ''), expected);
    return !!account && matched && normalizeId(b.userId) === account.userId;
  };
  const trust = (req) => {
    const value = cookie(req, '__Host-pt_device');
    if (!value) return null;
    const [id, signature] = value.split('.');
    return signature && equal(signature, mac('deviceCookieKey', id)) ? id : null;
  };
  const session = async (req, allowLocked = false) => {
    const bearer = req.headers.authorization?.startsWith('Bearer '),
      id = bearer ? req.headers.authorization.slice(7) : cookie(req, '__Host-pt_session');
    const s = id ? sessions.get(hash(id)) : null;
    if (
      bearer &&
      !['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(req.headers.origin)
    )
      reject(403, 'desktop_origin_required');
    if (!s || s.desktop !== !!bearer || now() - s.created >= 12 * 3600000) {
      if (id) sessions.delete(hash(id));
      if (s) await event('session_expired', s.desktop ? 'desktop' : 'browser');
      reject(401, 'expired');
    }
    if ((s.locked || now() - s.active >= 15 * 60000) && !allowLocked) {
      if (!s.locked) {
        s.locked = true;
        await event('locked', s.desktop ? 'desktop' : 'browser');
      }
      reject(401, 'locked');
    }
    if (!allowLocked) s.active = now();
    return { s, id, key: hash(id) };
  };
  const stepUp = (s) => {
    if (now() - s.proof > 5 * 60000) reject(403, 'step_up_required');
  };
  const csrf = (req) => {
    if (
      ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(
        req.headers.origin,
      ) &&
      !cookie(req, '__Host-pt_session') &&
      req.headers['x-pt-request'] === '1'
    )
      return;
    const site = req.headers['sec-fetch-site'];
    if (req.headers.authorization?.startsWith('Bearer ')) {
      if (
        !['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(
          req.headers.origin,
        )
      )
        reject(403, 'desktop_origin_required');
      return;
    }
    if (site && site !== 'same-origin') reject(403, 'cross_site');
    if (!site && req.headers.origin !== origin) reject(403, 'origin_required');
    if (req.headers['x-pt-request'] !== '1') reject(403, 'request_header_required');
  };
  const secondFactor = async (b, p) => {
    if (p.attempts++ >= 5 || now() - p.created > 5 * 60000) reject(401, 'second_factor_failed');
    if (b.method === 'totp') {
      const secret = openRest(account.totp);
      const step = Math.floor(now() / 30000);
      for (const n of [step - 1, step, step + 1])
        if (n > (account.lastTotp ?? -1) && equal(totp(secret, n), String(b.code))) {
          account.lastTotp = n;
          await saveAccount();
          return;
        }
    }
    if (b.method === 'recovery') {
      const digest = hash(String(b.code ?? '')),
        i = account.recovery.findIndex((c) => equal(c, digest));
      if (i >= 0) {
        account.recovery.splice(i, 1);
        await saveAccount();
        return;
      }
    }
    if (b.method === 'passkey' && p.challenge && now() - p.challengeAt <= 120000) {
      const challenge = p.challenge;
      delete p.challenge;
      const c = account.passkeys.find((c) => c.id === b.assertion?.id);
      if (c) {
        try {
          const result = await verifyAuthenticationResponse({
            response: b.assertion,
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRPID: publicUrl.hostname,
            credential: { ...c, publicKey: Buffer.from(c.publicKey, 'base64') },
            requireUserVerification: true,
          });
          if (result.verified) {
            p.passkeyId = c.id;
            c.counter = result.authenticationInfo.newCounter;
            await saveAccount();
            return;
          }
        } catch {
          /* Generic second-factor failure below. */
        }
      }
    }
    if (b.method === 'device' && p.desktop && p.deviceChallenge && now() - p.challengeAt <= 120000) {
      const challenge = p.deviceChallenge;
      delete p.deviceChallenge;
      const device = (account.devices ?? []).find((d) => d.id === b.deviceId);
      if (device) {
        try {
          const key = await webcrypto.subtle.importKey(
            'spki',
            Buffer.from(device.publicKey, 'base64'),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify'],
          );
          if (
            await webcrypto.subtle.verify(
              { name: 'ECDSA', hash: 'SHA-256' },
              key,
              Buffer.from(b.signature, 'base64'),
              Buffer.from(challenge, 'base64'),
            )
          ) {
            p.deviceId = device.id;
            return;
          }
        } catch {
          /* Generic factor error. */
        }
      }
    }
    await event('second_factor_failed');
    reject(401, 'second_factor_failed');
  };
  const sweep = async () => {
    let dirty = false;
    for (const name of await readdir(path.join(dataDirectory, 'reviews'))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const ref = name.slice(0, -5),
        file = path.join(dataDirectory, 'reviews', name),
        r = await read(file, null);
      if (r && Date.parse(r.expiresAt) <= now()) {
        state.tombstones[ref] = now();
        await unlink(file);
        dirty = true;
      }
    }
    for (const [ref, time] of Object.entries(state.tombstones))
      if (now() - time > 90 * DAY) {
        delete state.tombstones[ref];
        dirty = true;
      }
    if (dirty) await saveState();
  };
  await sweep();
  // Quarantine corrupt versions without reusing their revision numbers.
  for (const name of await readdir(path.join(dataDirectory, 'snapshots'))) {
    if (!/^\d+\.json$/.test(name)) continue;
    const rev = Number(name.slice(0, -5));
    state.head = Math.max(state.head, rev);
    try {
      const v = await read(path.join(dataDirectory, 'snapshots', name));
      if (!validEnvelope(v.envelope, 'snapshot', 'treasury', rev)) throw new Error('invalid');
    } catch {
      await rename(
        path.join(dataDirectory, 'snapshots', name),
        path.join(dataDirectory, 'quarantine', `${name}.${randomUUID()}`),
      );
      state.pruned[rev] = 'corrupt';
    }
  }
  await saveState();
  const interval = setInterval(() => {
    queue = queue
      .then(async () => {
        await sweep();
        await purgeSecurityLogs();
      })
      .catch(() => undefined);
  }, 3600000);
  interval.unref();
  async function route(req, res, url, b) {
    const pathname = url.pathname,
      method = req.method;
    if (pathname === '/api/auth/prelogin' && method === 'POST') {
      const id = normalizeId(b.userId);
      return json(res, 200, {
        scheme: 'argon2id-hkdf-v1',
        salt: account && id === account.userId ? account.salt : mac('pepper', `fake-salt|${id}`),
        params: account?.params ?? { m: 65536, t: 3, p: 1 },
      });
    }
    if (pathname.startsWith('/api/setup/')) {
      if (account) reject(404, 'not_found');
      if (!setupSecret || !equal(req.headers.authorization ?? '', `Bearer ${setupSecret}`))
        reject(401, 'unauthorized');
      if (pathname === '/api/setup/begin' && method === 'POST') {
        if (!validKeys(b) || normalizeId(b.userId).length < 3 || normalizeId(b.userId).length > 64)
          reject(400, 'invalid_enrollment');
        const id = randomBytes(32).toString('base64url'),
          secret = randomBytes(20),
          codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex'));
        enrollments.clear();
        enrollments.set(hash(id), {
          created: now(),
          record: {
            userId: normalizeId(b.userId),
            verifier: verifier(b.authKey),
            salt: b.salt,
            params: b.params,
            kid: b.kid,
            wrapped: sealRest(b.wrapped),
            totp: sealRest(secret.toString('base64')),
            recovery: codes.map(hash),
            passkeys: [],
            devices: [],
            lastTotp: -1,
          },
          secret: secret.toString('base64'),
        });
        return json(res, 200, { enrollment: id, totpSecret: base32(secret), recoveryCodes: codes });
      }
      if (pathname === '/api/setup/confirm' && method === 'POST') {
        const enrollment = enrollments.get(hash(String(b.enrollment)));
        if (!enrollment || now() - enrollment.created > 10 * 60000) reject(401, 'enrollment_expired');
        const step = Math.floor(now() / 30000);
        if (![step - 1, step, step + 1].some((n) => equal(totp(enrollment.secret, n), b.code)))
          reject(401, 'second_factor_failed');
        account = enrollment.record;
        account.lastTotp = step;
        await saveAccount();
        enrollments.clear();
        await event('setup_completed');
        return json(res, 200, { ok: true });
      }
      reject(404, 'not_found');
    }
    if (pathname === '/api/auth/device/challenge' && method === 'POST') {
      if (
        !['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(
          req.headers.origin,
        )
      )
        reject(403, 'desktop_origin_required');
      for (const [key, value] of deviceProofs) if (now() - value.created > 120000) deviceProofs.delete(key);
      if (deviceProofs.size >= 5000) reject(429, 'rate_limited');
      const challenge = randomBytes(32).toString('base64');
      deviceProofs.set(hash(challenge), { deviceId: String(b.deviceId ?? ''), created: now() });
      return json(res, 200, { challenge });
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      let desktopTrust = null;
      if (b.client === 'desktop' && b.deviceProof) {
        const proof = deviceProofs.get(hash(String(b.deviceProof.challenge)));
        deviceProofs.delete(hash(String(b.deviceProof.challenge)));
        const device = account?.devices.find((d) => d.id === proof?.deviceId && d.id === b.deviceId);
        if (proof && device && now() - proof.created <= 120000) {
          try {
            const key = await webcrypto.subtle.importKey(
              'spki',
              Buffer.from(device.publicKey, 'base64'),
              { name: 'ECDSA', namedCurve: 'P-256' },
              false,
              ['verify'],
            );
            if (
              await webcrypto.subtle.verify(
                { name: 'ECDSA', hash: 'SHA-256' },
                key,
                Buffer.from(b.deviceProof.signature, 'base64'),
                Buffer.from(b.deviceProof.challenge, 'base64'),
              )
            )
              desktopTrust = `desktop:${device.id}`;
          } catch {
            /* Unverified clients remain in the untrusted pool. */
          }
        }
      }
      const trusted = desktopTrust ?? trust(req),
        pool = trusted ? (state.trusted[trusted] ??= { failures: 0, lockedUntil: 0, closed: false }) : state;
      const resetAvailable = !!mfaReset && state.mfaResetUsed !== hash(mfaReset);
      if (
        (pool.closed || pool.lockedUntil > now() || (!trusted && state.breakerUntil > now())) &&
        !(resetAvailable && verifyPassword(b))
      ) {
        res.setHeader(
          'Retry-After',
          String(
            Math.max(
              60,
              Math.ceil(
                (Math.max(pool.lockedUntil, !trusted ? (state.breakerUntil ?? 0) : 0) - now()) / 1000,
              ),
            ),
          ),
        );
        reject(429, 'temporarily_locked');
      }
      if (!verifyPassword(b)) {
        pool.failures++;
        state.hourFailures = [
          ...(state.hourFailures ?? []).filter((time) => time > now() - 3600000),
          now(),
        ].slice(-1001);
        if (state.hourFailures.length > 1000) {
          state.breakerUntil = now() + 3600000;
          await event('global_lockout');
        }
        const threshold = trusted ? 10 : 5;
        if (pool.failures >= threshold)
          pool.lockedUntil =
            now() +
            Math.min(
              3600000,
              (trusted ? 300000 : 60000) * 2 ** Math.floor((pool.failures - threshold) / threshold),
            );
        if (!trusted && pool.failures >= 100) pool.closed = true;
        if (pool.failures >= threshold && pool.failures % threshold === 0)
          await event(trusted ? 'trusted_device_lockout' : 'untrusted_pool_lockout');
        await event('sign_in_failed');
        reject(401, 'unauthorized');
      }
      const desktop = b.client === 'desktop';
      if (
        desktop &&
        !['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(
          req.headers.origin,
        )
      )
        reject(403, 'desktop_origin_required');
      const id = randomBytes(32).toString('base64url');
      pending.set(hash(id), {
        created: now(),
        attempts: 0,
        desktop,
        trusted,
        resetAllowed: resetAvailable ? hash(mfaReset) : null,
      });
      if (!desktop) res.setHeader('Set-Cookie', cookieValue('__Host-pt_pending', id, '; Max-Age=300'));
      return json(res, 200, {
        pending: desktop ? id : undefined,
        resetRequired: resetAvailable,
        methods: account.passkeys.length ? ['passkey', 'totp', 'recovery'] : ['totp', 'recovery'],
      });
    }
    if (pathname.startsWith('/api/auth/factor') && method === 'POST') {
      const id = b.pending ?? cookie(req, '__Host-pt_pending'),
        p = pending.get(hash(String(id)));
      if (!p || now() - p.created > 5 * 60000) reject(401, 'second_factor_failed');
      if (
        p.desktop &&
        !['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'].includes(
          req.headers.origin,
        )
      )
        reject(403, 'desktop_origin_required');
      if (pathname === '/api/auth/factor/reset/begin') {
        if (!p.resetAllowed || p.resetAllowed === state.mfaResetUsed) reject(403, 'reset_unavailable');
        state.mfaResetUsed = p.resetAllowed;
        await event('mfa_break_glass_started');
        const secret = randomBytes(20).toString('base64'),
          codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex'));
        p.reset = { secret, recovery: codes.map(hash) };
        return json(res, 200, { totpSecret: base32(Buffer.from(secret, 'base64')), recoveryCodes: codes });
      }
      if (pathname === '/api/auth/factor/reset/confirm') {
        if (!p.reset || p.attempts++ >= 5) reject(401, 'second_factor_failed');
        const step = Math.floor(now() / 30000),
          matched = [step - 1, step, step + 1].find((n) => equal(totp(p.reset.secret, n), String(b.code)));
        if (matched === undefined) reject(401, 'second_factor_failed');
        const next = {
          ...account,
          totp: sealRest(p.reset.secret),
          recovery: p.reset.recovery,
          lastTotp: matched,
          passkeys: [],
          devices: [],
        };
        await atomic(accountFile, next);
        account = next;
        sessions.clear();
        deviceProofs.clear();
        enrollments.clear();
        for (const other of pending.keys()) if (other !== hash(String(id))) pending.delete(other);
        p.reenrolled = true;
        await event('mfa_break_glass_completed');
      }
      if (p.resetAllowed && !p.reenrolled && pathname !== '/api/auth/factor/reset/confirm')
        reject(403, 'reenrollment_required');
      if (pathname === '/api/auth/factor/device') {
        if (!p.desktop) reject(403, 'desktop_required');
        p.deviceChallenge = randomBytes(32).toString('base64');
        p.challengeAt = now();
        return json(res, 200, { challenge: p.deviceChallenge });
      }
      if (pathname === '/api/auth/factor/options') {
        const options = await generateAuthenticationOptions({
          rpID: publicUrl.hostname,
          userVerification: 'required',
          allowCredentials: account.passkeys.map((c) => ({ id: c.id, transports: c.transports })),
          challenge: randomBytes(32),
        });
        p.challenge = options.challenge;
        p.challengeAt = now();
        return json(res, 200, options);
      }
      if (!p.reenrolled && p.desktop && !['totp', 'device'].includes(b.method))
        reject(401, 'second_factor_failed');
      if (!p.reenrolled) await secondFactor(b, p);
      pending.delete(hash(String(id)));
      state.failures = 0;
      state.lockedUntil = 0;
      state.closed = false;
      if (p.trusted) state.trusted[p.trusted] = { failures: 0, lockedUntil: 0, closed: false };
      const token = randomBytes(32).toString('base64url');
      sessions.set(hash(token), {
        created: now(),
        active: now(),
        proof: b.method === 'recovery' ? 0 : now(),
        deviceId: p.deviceId,
        passkeyId: p.passkeyId,
        desktop: p.desktop,
        locked: false,
        writes: [],
      });
      if (!p.desktop) {
        const device = p.trusted ?? randomUUID();
        state.trusted[device] = { failures: 0, lockedUntil: 0, closed: false };
        res.setHeader('Set-Cookie', [
          cookieValue('__Host-pt_session', token),
          cookieValue('__Host-pt_pending', '', '; Max-Age=0'),
          cookieValue(
            '__Host-pt_device',
            `${device}.${mac('deviceCookieKey', device)}`,
            '; Max-Age=31536000',
          ),
        ]);
      }
      await event('sign_in_succeeded', p.desktop ? 'desktop' : 'browser');
      return json(res, 200, {
        token: p.desktop ? token : undefined,
        wrapped: openRest(account.wrapped),
        kid: account.kid,
        userId: account.userId,
      });
    }
    const { s, key } = await session(
      req,
      pathname === '/api/auth/unlock' || pathname === '/api/auth/session' || pathname === '/api/auth/logout',
    );
    if (pathname === '/api/auth/session' && method === 'GET')
      return json(res, 200, { userId: account.userId, locked: s.locked || now() - s.active >= 15 * 60000 });
    if (pathname === '/api/auth/unlock' && method === 'POST') {
      if (!verifyPassword(b)) reject(401, 'unauthorized');
      s.locked = false;
      s.active = now();
      await event('unlocked');
      return json(res, 200, {
        wrapped: openRest(account.wrapped),
        kid: account.kid,
        userId: account.userId,
      });
    }
    if (pathname === '/api/auth/lock' && method === 'POST') {
      s.locked = true;
      await event('locked');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      sessions.delete(key);
      res.setHeader('Set-Cookie', cookieValue('__Host-pt_session', '', '; Max-Age=0'));
      res.setHeader('Clear-Site-Data', b.remove ? '"cache", "cookies", "storage"' : '"cache"');
      await event('signed_out');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/step-up/options' && method === 'POST') {
      if (s.desktop) reject(403, 'web_required');
      const options = await generateAuthenticationOptions({
        rpID: publicUrl.hostname,
        userVerification: 'required',
        allowCredentials: account.passkeys.map((c) => ({ id: c.id, transports: c.transports })),
        challenge: randomBytes(32),
      });
      s.stepUp = { created: now(), attempts: 0, challenge: options.challenge, challengeAt: now() };
      return json(res, 200, options);
    }
    if (pathname === '/api/auth/step-up/device' && method === 'POST') {
      if (!s.desktop) reject(403, 'desktop_required');
      if (!verifyPassword(b)) reject(401, 'unauthorized');
      const device = account.devices.find((d) => d.id === s.deviceId);
      if (!device) reject(401, 'device_revoked');
      s.stepUp = {
        created: now(),
        attempts: 0,
        desktop: true,
        deviceChallenge: randomBytes(32).toString('base64'),
        challengeAt: now(),
      };
      return json(res, 200, { challenge: s.stepUp.deviceChallenge });
    }
    if (pathname === '/api/auth/step-up' && method === 'POST') {
      if (s.desktop ? b.method !== 'device' : !['totp', 'passkey'].includes(b.method))
        reject(403, 'fresh_factor_required');
      const proof = s.stepUp ?? { created: now(), attempts: 0 };
      delete s.stepUp;
      if (s.desktop && b.deviceId !== s.deviceId) reject(401, 'second_factor_failed');
      await secondFactor(b, proof);
      s.proof = now();
      const token = randomBytes(32).toString('base64url');
      sessions.delete(key);
      sessions.set(hash(token), s);
      if (!s.desktop) res.setHeader('Set-Cookie', cookieValue('__Host-pt_session', token));
      await event('step_up_completed');
      return json(res, 200, { ok: true, token: s.desktop ? token : undefined });
    }
    if (pathname === '/api/auth/recovery/regenerate' && method === 'POST') {
      stepUp(s);
      const codes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex'));
      const next = { ...account, recovery: codes.map(hash) };
      await atomic(accountFile, next);
      account = next;
      pending.clear();
      await event('recovery_codes_regenerated');
      return json(res, 200, { codes });
    }
    if (pathname === '/api/auth/authenticator/begin' && method === 'POST') {
      stepUp(s);
      const secret = randomBytes(20).toString('base64');
      s.authenticator = { secret, created: now() };
      return json(res, 200, { secret: base32(Buffer.from(secret, 'base64')) });
    }
    if (pathname === '/api/auth/authenticator/confirm' && method === 'POST') {
      stepUp(s);
      const enrollment = s.authenticator;
      if (!enrollment || now() - enrollment.created > 10 * 60000) reject(400, 'enrollment_expired');
      const step = Math.floor(now() / 30000),
        matched = [step - 1, step, step + 1].find((n) => equal(totp(enrollment.secret, n), b.code));
      if (matched === undefined) reject(401, 'second_factor_failed');
      const next = { ...account, totp: sealRest(enrollment.secret), lastTotp: matched };
      await atomic(accountFile, next);
      account = next;
      delete s.authenticator;
      pending.clear();
      for (const k of sessions.keys()) if (k !== key) sessions.delete(k);
      await event('authenticator_replaced');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/passkeys/revoke' && method === 'POST') {
      stepUp(s);
      if (!account.passkeys.some((c) => c.id === b.id)) reject(404, 'not_found');
      const next = { ...account, passkeys: account.passkeys.filter((c) => c.id !== b.id) };
      await atomic(accountFile, next);
      account = next;
      for (const [k, value] of sessions) if (value.passkeyId === b.id) sessions.delete(k);
      pending.clear();
      await event('passkey_revoked');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/sessions/revoke' && method === 'POST') {
      stepUp(s);
      if (!sessions.has(b.id)) reject(404, 'not_found');
      sessions.delete(b.id);
      await event('session_revoked');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/password/key' && method === 'POST') {
      stepUp(s);
      if (!s.desktop) reject(403, 'desktop_required');
      if (!verifyPassword(b)) reject(401, 'unauthorized');
      return json(res, 200, { wrapped: openRest(account.wrapped), kid: account.kid });
    }
    if (pathname === '/api/auth/logout-all' && method === 'POST') {
      stepUp(s);
      sessions.clear();
      await event('signed_out_everywhere');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/devices' && method === 'POST') {
      stepUp(s);
      if (!s.desktop) reject(403, 'desktop_required');
      try {
        await webcrypto.subtle.importKey(
          'spki',
          Buffer.from(b.publicKey, 'base64'),
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        );
      } catch {
        reject(400, 'invalid_device_key');
      }
      const id = randomUUID();
      account.devices ??= [];
      if (account.devices.length >= 50) reject(409, 'device_limit');
      account.devices.push({ id, publicKey: b.publicKey, createdAt: new Date(now()).toISOString() });
      s.deviceId = id;
      await saveAccount();
      await event('device_registered');
      return json(res, 200, { id });
    }
    if (pathname === '/api/auth/devices' && method === 'GET')
      return json(
        res,
        200,
        (account.devices ?? []).map((d) => ({ id: d.id, createdAt: d.createdAt })),
      );
    if (pathname === '/api/auth/devices/revoke' && method === 'POST') {
      stepUp(s);
      if (!account.devices.some((d) => d.id === b.id)) reject(404, 'not_found');
      account.devices = (account.devices ?? []).filter((d) => d.id !== b.id);
      for (const [k, value] of sessions) if (value.deviceId === b.id) sessions.delete(k);
      pending.clear();
      await saveAccount();
      await event('device_revoked');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/activity' && method === 'GET')
      return json(res, 200, state.events.slice(-100).reverse());
    if (pathname === '/api/auth/sessions' && method === 'GET')
      return json(
        res,
        200,
        [...sessions].map(([k, v]) => ({
          id: k,
          current: k === key,
          desktop: v.desktop,
          createdAt: new Date(v.created).toISOString(),
          lastActiveAt: new Date(v.active).toISOString(),
        })),
      );
    if (pathname === '/api/auth/password' && method === 'POST') {
      stepUp(s);
      if (!s.desktop) reject(403, 'desktop_required');
      if (!validKeys(b) || b.kid !== account.kid) reject(400, 'invalid_keys');
      if (!verifyPassword({ ...b, authKey: b.currentAuthKey })) reject(401, 'unauthorized');
      const next = {
        ...account,
        verifier: verifier(b.authKey),
        salt: b.salt,
        params: b.params,
        wrapped: sealRest(b.wrapped),
        kid: b.kid,
      };
      await atomic(accountFile, next);
      account = next;
      pending.clear();
      state.trusted = {};
      for (const k of sessions.keys()) if (k !== key) sessions.delete(k);
      await event('password_changed');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/passkeys' && method === 'GET')
      return json(
        res,
        200,
        account.passkeys.map((c) => ({ id: c.id, createdAt: c.createdAt })),
      );
    if (pathname === '/api/auth/passkeys/options' && method === 'POST') {
      stepUp(s);
      if (account.passkeys.length >= 20) reject(409, 'passkey_limit');
      const options = await generateRegistrationOptions({
        rpName: 'Personal Treasury',
        rpID: publicUrl.hostname,
        userName: account.userId,
        userID: Buffer.from(hash(account.userId)),
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: account.passkeys.map((c) => ({ id: c.id })),
        challenge: randomBytes(32),
      });
      s.registration = { challenge: options.challenge, created: now() };
      return json(res, 200, options);
    }
    if (pathname === '/api/auth/passkeys/verify' && method === 'POST') {
      stepUp(s);
      const registration = s.registration;
      delete s.registration;
      if (!registration || now() - registration.created > 120000) reject(400, 'challenge_expired');
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: b,
          expectedChallenge: registration.challenge,
          expectedOrigin: origin,
          expectedRPID: publicUrl.hostname,
          requireUserVerification: true,
        });
      } catch {
        reject(400, 'passkey_invalid');
      }
      if (!result.verified) reject(400, 'passkey_invalid');
      const c = result.registrationInfo.credential;
      if (account.passkeys.some((p) => p.id === c.id)) reject(409, 'already_registered');
      account.passkeys.push({
        ...c,
        publicKey: Buffer.from(c.publicKey).toString('base64'),
        createdAt: new Date(now()).toISOString(),
      });
      await saveAccount();
      await event('passkey_registered');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/migration/status' && method === 'GET')
      return json(res, 200, {
        required: legacyNames.length > 0 && state.migration?.phase !== 'committed',
        phase: state.migration?.phase ?? 'not_started',
        count: state.migration?.count ?? legacyNames.length,
        verified: state.migration?.verified ?? [],
      });
    if (pathname.startsWith('/api/migration/')) {
      if (!s.desktop) reject(403, 'desktop_required');
      stepUp(s);
      if (pathname === '/api/migration/start' && method === 'POST') {
        if (!legacyNames.length || state.migration?.phase === 'committed')
          reject(409, 'migration_not_available');
        if (!state.migration) {
          const head = await read(path.join(dataDirectory, 'head.json'), { revision: 0 });
          state.migration = { phase: 'copying', count: head.revision, verified: [] };
          await event('migration_started');
        }
        return json(res, 200, state.migration);
      }
      const match = /^\/api\/migration\/versions\/([1-9]\d*)$/.exec(pathname);
      if (match) {
        const revision = Number(match[1]);
        if (state.migration?.phase !== 'copying' || revision > state.migration.count)
          reject(409, 'migration_not_started');
        const file = path.join(dataDirectory, 'snapshots', `${revision}.json`);
        if (method === 'GET') {
          const value = await read(file, null);
          if (!value) reject(404, 'not_found');
          return json(res, 200, value);
        }
        if (method === 'PUT') {
          if (!validEnvelope(b.envelope, 'snapshot', 'treasury', revision)) reject(400, 'invalid_snapshot');
          const prior = await read(file, null);
          if (prior) return json(res, 200, { revision, existing: true });
          const legacy = await read(path.join(dataDirectory, 'versions', `${revision}.json`));
          await atomic(file, { revision, createdAt: legacy.createdAt, envelope: b.envelope });
          return json(res, 200, { revision });
        }
      }
      if (pathname === '/api/migration/verify' && method === 'POST') {
        if (state.migration?.phase !== 'copying') reject(409, 'migration_not_started');
        const revision = Number(b.revision);
        if (!Number.isSafeInteger(revision) || revision < 1 || revision > state.migration.count)
          reject(400, 'invalid_revision');
        const value = await read(path.join(dataDirectory, 'snapshots', `${revision}.json`), null);
        if (!value || hash(JSON.stringify(value.envelope)) !== b.envelopeDigest)
          reject(400, 'verification_failed');
        if (!state.migration.verified.includes(revision)) state.migration.verified.push(revision);
        await saveState();
        return json(res, 200, { ok: true });
      }
      if (pathname === '/api/migration/commit' && method === 'POST') {
        if (state.migration?.phase !== 'copying' || state.migration.verified.length !== state.migration.count)
          reject(409, 'migration_incomplete');
        for (let revision = 1; revision <= state.migration.count; revision++) {
          const value = await read(path.join(dataDirectory, 'snapshots', `${revision}.json`), null);
          if (!value || !state.migration.verified.includes(revision)) reject(409, 'migration_incomplete');
        }
        state.head = state.migration.count;
        state.migration.phase = 'committed';
        await event('migration_committed');
        return json(res, 200, { ok: true });
      }
      if (pathname === '/api/migration/delete-legacy' && method === 'POST') {
        if (state.migration?.phase !== 'committed' || b.confirmed !== true)
          reject(409, 'confirmation_required');
        await rm(path.join(dataDirectory, 'versions'), { recursive: true, force: true });
        await unlink(path.join(dataDirectory, 'head.json')).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        await event('legacy_history_deleted');
        return json(res, 200, { ok: true });
      }
      if (pathname === '/api/migration/cancel' && method === 'POST') {
        if (state.migration?.phase !== 'copying') reject(409, 'migration_not_started');
        for (const name of await readdir(path.join(dataDirectory, 'snapshots')))
          if (/^[1-9]\d*\.json$/.test(name)) await unlink(path.join(dataDirectory, 'snapshots', name));
        state.migration = null;
        state.head = 0;
        await event('migration_cancelled');
        return json(res, 200, { ok: true });
      }
      reject(404, 'not_found');
    }
    if (
      legacyNames.length &&
      state.migration?.phase !== 'committed' &&
      (pathname.startsWith('/api/sync/') || pathname.startsWith('/api/review') || pathname === '/api/vault')
    )
      reject(423, 'migration_required');
    if (pathname === '/api/sync/head' && method === 'GET') return json(res, 200, { revision: state.head });
    if (pathname === '/api/sync/versions' && method === 'GET') {
      const versions = [];
      for (const name of await readdir(path.join(dataDirectory, 'snapshots'))) {
        if (!/^\d+\.json$/.test(name)) continue;
        const v = await read(path.join(dataDirectory, 'snapshots', name));
        versions.push({
          revision: v.revision,
          createdAt: v.createdAt,
          pinned: state.pinned.includes(v.revision),
        });
      }
      return json(
        res,
        200,
        versions.sort((a, b) => b.revision - a.revision),
      );
    }
    const versionMatch = /^\/api\/sync\/versions\/([1-9]\d*)$/.exec(pathname);
    if (versionMatch && method === 'GET') {
      const value = await read(path.join(dataDirectory, 'snapshots', `${versionMatch[1]}.json`), null);
      if (!value) reject(404, 'not_found');
      return json(res, 200, value);
    }
    if (pathname === '/api/sync/head' && method === 'PUT') {
      if (req.headers['if-match'] !== `"${state.head}"`) reject(409, 'revision_conflict');
      const revision = state.head + 1;
      if (!validEnvelope(b.envelope, 'snapshot', 'treasury', revision)) reject(400, 'invalid_snapshot');
      s.writes = s.writes.filter((time) => time > now() - 3600000);
      if (s.writes.length >= 90) {
        res.setHeader('Retry-After', '60');
        reject(429, 'write_limit');
      }
      let size = 0;
      for (const name of await readdir(path.join(dataDirectory, 'snapshots')))
        size += (await stat(path.join(dataDirectory, 'snapshots', name))).size;
      if (size + JSON.stringify(b).length > 2 * 1024 ** 3) reject(507, 'quota_exceeded');
      const value = { revision, createdAt: new Date(now()).toISOString(), envelope: b.envelope };
      await atomic(path.join(dataDirectory, 'snapshots', `${revision}.json`), value);
      state.head = revision;
      s.writes.push(now());
      await saveState();
      return json(res, 200, { revision });
    }
    if (pathname === '/api/sync/pin' && method === 'POST') {
      stepUp(s);
      if (!Number.isSafeInteger(b.revision) || b.revision < 1 || b.revision > state.head)
        reject(400, 'invalid_revision');
      state.pinned = state.pinned.filter((r) => r !== b.revision);
      if (b.pinned) state.pinned.push(b.revision);
      await event('snapshot_pin_changed');
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/sync/prune' && method === 'POST') {
      stepUp(s);
      const rows = [];
      for (const name of await readdir(path.join(dataDirectory, 'snapshots'))) {
        if (/^\d+\.json$/.test(name)) rows.push(await read(path.join(dataDirectory, 'snapshots', name)));
      }
      rows.sort((a, b) => b.revision - a.revision);
      const kept = new Set();
      let count = 0;
      for (const r of rows) {
        const age = now() - Date.parse(r.createdAt),
          period = r.createdAt.slice(0, age < 90 * DAY ? 10 : 7);
        if (age < 14 * DAY || state.pinned.includes(r.revision) || r.revision === state.head) {
          kept.add(period);
          continue;
        }
        if (kept.has(period)) {
          state.pruned[r.revision] = hash(JSON.stringify(r.envelope));
          await unlink(path.join(dataDirectory, 'snapshots', `${r.revision}.json`));
          count++;
        } else kept.add(period);
      }
      await event('snapshots_pruned');
      return json(res, 200, { count });
    }
    if (pathname === '/api/review' && method === 'GET') {
      const reviews = [];
      for (const name of await readdir(path.join(dataDirectory, 'reviews'))) {
        if (/^[a-f0-9-]{36}\.json$/.test(name)) {
          const r = await read(path.join(dataDirectory, 'reviews', name));
          if (Date.parse(r.expiresAt) > now())
            reviews.push({
              ref: name.slice(0, -5),
              revision: r.revision,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              expiresAt: r.expiresAt,
              header: r.header,
            });
        }
      }
      return json(res, 200, { reviews, tombstones: Object.keys(state.tombstones) });
    }
    const reviewMatch = /^\/api\/review\/([a-f0-9-]{36})$/.exec(pathname);
    if (reviewMatch) {
      const ref = reviewMatch[1],
        file = path.join(dataDirectory, 'reviews', `${ref}.json`);
      const old = await read(file, null);
      if (method === 'GET') {
        if (!old || state.tombstones[ref] || Date.parse(old.expiresAt) <= now()) reject(404, 'not_found');
        return json(res, 200, old);
      }
      if (method === 'DELETE') {
        if (old && req.headers['if-match'] !== `"${old.revision}"`) reject(409, 'revision_conflict');
        state.tombstones[ref] = now();
        await saveState();
        if (old) await unlink(file);
        await event('review_deleted');
        return json(res, 200, { ok: true });
      }
      if (method === 'PUT') {
        if (state.tombstones[ref]) reject(410, 'review_deleted');
        if (old && Date.parse(old.expiresAt) <= now()) reject(410, 'review_expired');
        const revision = (old?.revision ?? 0) + 1;
        if (req.headers['if-match'] !== `"${revision - 1}"`) reject(409, 'revision_conflict');
        if (
          !validEnvelope(b.envelope, 'review', ref, revision) ||
          !validEnvelope(b.header, 'review-header', ref, revision)
        )
          reject(400, 'invalid_review');
        if (JSON.stringify(b).length > 8 * 1024 * 1024) reject(413, 'review_too_large');
        if (
          !old &&
          (await readdir(path.join(dataDirectory, 'reviews'))).filter((n) => n.endsWith('.json')).length >= 3
        )
          reject(409, 'review_limit');
        const createdAt = old?.createdAt ?? new Date(now()).toISOString(),
          expiresAt = new Date(Math.min(now() + 14 * DAY, Date.parse(createdAt) + 45 * DAY)).toISOString();
        const value = {
          revision,
          createdAt,
          updatedAt: new Date(now()).toISOString(),
          expiresAt,
          envelope: b.envelope,
          header: b.header,
        };
        await atomic(file, value);
        return json(res, 200, { revision, createdAt, expiresAt });
      }
    }
    if (pathname === '/api/vault') {
      if (!s.desktop) reject(403, 'desktop_required');
      stepUp(s);
      const file = path.join(dataDirectory, 'vault.json'),
        old = await read(file, null);
      if (method === 'GET') return json(res, 200, old ?? { revision: 0 });
      if (method === 'PUT') {
        const revision = (old?.revision ?? 0) + 1;
        if (req.headers['if-match'] !== `"${revision - 1}"`) reject(409, 'revision_conflict');
        if (
          !validEnvelope(b.envelope, 'vault', 'credentials', revision) ||
          JSON.stringify(b).length > 1024 * 1024
        )
          reject(400, 'invalid_vault');
        await atomic(file, { revision, envelope: b.envelope });
        await event('vault_changed');
        return json(res, 200, { revision });
      }
    }
    reject(404, 'not_found');
  }
  const server = http.createServer(
    { maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000, keepAliveTimeout: 5000 },
    async (req, res) => {
      securityHeaders(res);
      const started = performance.now(),
        requestId = randomBytes(16).toString('hex');
      let routeTemplate = 'unmatched',
        inputBytes = 0;
      const forwarded = req.headers['x-real-ip'];
      const clientIp =
        trustProxy && typeof forwarded === 'string' && isIP(forwarded)
          ? forwarded
          : (req.socket.remoteAddress ?? 'unknown');
      const ipTag = mac('logKey', clientIp);
      res.once('finish', () => {
        try {
          requestLogger({
            time: new Date(now()).toISOString(),
            requestId,
            method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(req.method)
              ? req.method
              : 'OTHER',
            route: routeTemplate,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
            inputBytes,
            outputBytes: Number(res.getHeader('Content-Length') ?? 0),
            ipTag,
          });
        } catch {
          /* Logging callbacks cannot expose request details in an error. */
        }
      });
      try {
        const url = new URL(req.url, 'http://localhost');
        routeTemplate = logRoute(url.pathname);
        if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
        if (!url.pathname.startsWith('/api/')) {
          if (!staticDirectory || !['GET', 'HEAD'].includes(req.method)) reject(404, 'not_found');
          const root = await realpath(staticDirectory);
          let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
          if (file === root) file = path.join(root, 'index.html');
          const actual = await realpath(file).catch(() => null);
          if (!actual || !actual.startsWith(`${root}${path.sep}`) || (await stat(actual)).isDirectory())
            reject(404, 'not_found');
          const types = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.wasm': 'application/wasm',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
          };
          res.setHeader('Content-Type', types[path.extname(actual)] ?? 'application/octet-stream');
          res.setHeader('Content-Length', (await stat(actual)).size);
          if (req.method === 'HEAD') return res.end();
          createReadStream(actual).pipe(res);
          return;
        }
        if (
          legacyToken &&
          equal(req.headers.authorization ?? '', `Bearer ${legacyToken}`) &&
          url.pathname.startsWith('/api/sync/')
        ) {
          const task = queue.then(() => {
            if (state.migration?.phase === 'committed') reject(401, 'unauthorized');
            if (state.migration?.phase === 'copying' && req.method === 'PUT')
              reject(423, 'migration_write_freeze');
            return new Promise((resolve) => {
              res.once('finish', resolve);
              if (legacyServer) legacyServer.emit('request', req, res);
              else json(res, 401, { error: 'unauthorized' });
            });
          });
          queue = task.catch(() => undefined);
          await task;
          return;
        }
        if (req.headers.origin && !origins.has(req.headers.origin)) reject(403, 'origin_forbidden');
        if (req.headers.origin) {
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        if (req.method === 'OPTIONS') {
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Authorization, Content-Type, If-Match, X-PT-Request',
          );
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.writeHead(204);
          return res.end();
        }
        if (req.method !== 'GET') csrf(req);
        if (
          [
            '/api/auth/login',
            '/api/auth/prelogin',
            '/api/auth/unlock',
            '/api/auth/factor',
            '/api/auth/step-up',
          ].includes(url.pathname) ||
          url.pathname === '/api/auth/device/challenge' ||
          url.pathname.startsWith('/api/auth/step-up/') ||
          url.pathname.startsWith('/api/auth/authenticator/') ||
          url.pathname.startsWith('/api/setup/')
        ) {
          const ip = ipTag;
          const r = rates.get(ip) ?? { tokens: 5, at: now() };
          r.tokens = Math.min(5, r.tokens + (now() - r.at) / 6000);
          r.at = now();
          if (r.tokens < 1) {
            res.setHeader('Retry-After', '6');
            reject(429, 'rate_limited');
          }
          r.tokens--;
          if (rates.size > 5000) rates.delete(rates.keys().next().value);
          rates.set(ip, r);
        }
        let b = {};
        if (!['GET', 'HEAD'].includes(req.method)) {
          if (!req.headers['content-type']?.startsWith('application/json')) reject(415, 'json_required');
          let size = 0;
          const parts = [];
          for await (const chunk of req) {
            size += chunk.length;
            inputBytes = size;
            if (size > 32 * 1024 * 1024) reject(413, 'payload_too_large');
            parts.push(chunk);
          }
          try {
            b = JSON.parse(Buffer.concat(parts).toString());
          } catch {
            reject(400, 'invalid_json');
          }
          if (!bodyObject(b)) reject(400, 'invalid_json');
        }
        // Serialize state transitions so replay protection and conditional writes are atomic.
        const task = queue.then(() => route(req, res, url, b));
        queue = task.catch(() => undefined);
        await task;
      } catch (e) {
        if (!res.headersSent) json(res, e.status ?? 500, { error: e.status ? e.message : 'internal_error' });
        else res.destroy();
      }
    },
  );
  server.on('close', () => clearInterval(interval));
  return server;
}
