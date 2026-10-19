// Wire-byte limits include JSON syntax and base64/envelope overhead.
export const BODY_LIMITS = Object.freeze({
  control: 64 * 1024,
  passkey: 256 * 1024,
  snapshot: 32 * 1024 ** 2,
  review: 8 * 1024 ** 2,
  vault: 1024 ** 2,
});
export const INGESTION_LIMITS = Object.freeze({
  requests: 16,
  uploads: 4,
  bytes: 64 * 1024 ** 2,
  timeoutMs: 30000,
});

const routes = new Map();
const add = (paths, methods, auth = 'session', limit = BODY_LIMITS.control, options = {}) => {
  for (const pathname of paths.split(' '))
    for (const method of methods.split(' '))
      routes.set(`${method} ${pathname}`, { auth, limit: method === 'GET' ? 0 : limit, ...options });
};
add('/api/auth/prelogin /api/auth/login', 'POST', 'public');
add('/api/auth/device/challenge', 'POST', 'device');
add('/api/setup/begin /api/setup/confirm', 'POST', 'setup');
add(
  '/api/auth/factor /api/auth/factor/options /api/auth/factor/device /api/auth/factor/reset/begin /api/auth/factor/reset/confirm',
  'POST',
  'pending',
  BODY_LIMITS.passkey,
);
add('/api/auth/session', 'GET', 'session', 0, { allowLocked: true });
add('/api/auth/unlock /api/auth/logout', 'POST', 'session', BODY_LIMITS.control, { allowLocked: true });
add(
  '/api/auth/activity /api/auth/sessions /api/auth/devices /api/auth/passkeys /api/migration/status /api/sync/head /api/sync/versions /api/review',
  'GET',
);
add(
  '/api/auth/lock /api/auth/step-up /api/auth/step-up/options /api/auth/step-up/device',
  'POST',
  'session',
  BODY_LIMITS.passkey,
);
add(
  '/api/auth/recovery/regenerate /api/auth/authenticator/begin /api/auth/authenticator/confirm /api/auth/passkeys/revoke /api/auth/sessions/revoke /api/auth/logout-all /api/auth/devices/revoke /api/sync/pin /api/sync/prune',
  'POST',
  'session',
  BODY_LIMITS.control,
  { fresh: true },
);
add('/api/auth/password /api/auth/password/key /api/auth/devices', 'POST', 'session', BODY_LIMITS.control, {
  fresh: true,
  desktop: true,
});
add('/api/auth/passkeys/options /api/auth/passkeys/verify', 'POST', 'session', BODY_LIMITS.passkey, {
  fresh: true,
});
add(
  '/api/migration/start /api/migration/verify /api/migration/commit /api/migration/delete-legacy /api/migration/cancel',
  'POST',
  'session',
  BODY_LIMITS.control,
  { fresh: true, desktop: true },
);
add('/api/sync/head', 'PUT', 'session', BODY_LIMITS.snapshot);
add('/api/vault', 'GET PUT', 'session', BODY_LIMITS.vault, { fresh: true, desktop: true });

export function requestPolicy(pathname, method, legacy = false) {
  if (legacy) {
    if (
      (pathname === '/api/sync/head' && ['GET', 'PUT'].includes(method)) ||
      (method === 'GET' &&
        (pathname === '/api/sync/versions' || /^\/api\/sync\/versions\/[1-9]\d*$/.test(pathname)))
    )
      return { auth: 'legacy', limit: method === 'PUT' ? BODY_LIMITS.snapshot : 0 };
    return null;
  }
  const exact = routes.get(`${method} ${pathname}`);
  if (exact) return exact;
  if (/^\/api\/sync\/versions\/[1-9]\d*$/.test(pathname) && method === 'GET')
    return { auth: 'session', limit: 0 };
  if (/^\/api\/migration\/versions\/[1-9]\d*$/.test(pathname) && ['GET', 'PUT'].includes(method))
    return {
      auth: 'session',
      limit: method === 'PUT' ? BODY_LIMITS.snapshot : 0,
      fresh: true,
      desktop: true,
    };
  if (/^\/api\/review\/[a-f0-9-]{36}$/.test(pathname) && ['GET', 'PUT', 'DELETE'].includes(method))
    return {
      auth: 'session',
      limit: method === 'GET' ? 0 : method === 'PUT' ? BODY_LIMITS.review : BODY_LIMITS.control,
    };
  return null;
}

export function ingestionError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Reserve the full route cap, not the untrusted Content-Length, until work completes.
export function createIngestionBudget(limits = INGESTION_LIMITS) {
  if (
    !Number.isInteger(limits.requests) ||
    limits.requests < 1 ||
    limits.requests > 16 ||
    !Number.isInteger(limits.uploads) ||
    limits.uploads < 1 ||
    limits.uploads > Math.min(4, limits.requests) ||
    !Number.isInteger(limits.bytes) ||
    limits.bytes < BODY_LIMITS.snapshot ||
    limits.bytes > INGESTION_LIMITS.bytes
  )
    throw new Error('Invalid ingestion limits (requests 1–16, uploads 1–4, bytes 32–64 MiB)');
  let requests = 0,
    uploads = 0,
    bytes = 0;
  return {
    acquire(size) {
      if (requests >= limits.requests || (size && uploads >= limits.uploads) || bytes + size > limits.bytes)
        throw ingestionError(503, 'ingestion_busy');
      requests++;
      bytes += size;
      if (size) uploads++;
      let uploading = !!size,
        released = false;
      const uploaded = () => {
        if (uploading) uploads--;
        uploading = false;
      };
      return {
        uploaded,
        release() {
          if (released) return;
          released = true;
          uploaded();
          requests--;
          bytes -= size;
        },
      };
    },
  };
}

export function checkBodyHeaders(req, limit) {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw ingestionError(400, 'invalid_content_length');
  if (Number(length) > limit || (!limit && req.headers['transfer-encoding']))
    throw ingestionError(413, 'payload_too_large');
  if (limit && !req.headers['content-type']?.startsWith('application/json'))
    throw ingestionError(415, 'json_required');
}

// Encrypted envelopes contain opaque strings, not arbitrarily large object graphs.
// Bound parser object/depth amplification before constructing a JS string or object.
function checkStructure(bytes) {
  let quoted = false,
    escaped = false,
    depth = 0,
    tokens = 0;
  for (const byte of bytes) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) quoted = false;
    } else if (byte === 34) quoted = true;
    else if (byte === 123 || byte === 91) {
      if (++depth > 32 || ++tokens > 4096) throw ingestionError(400, 'json_too_complex');
    } else if (byte === 125 || byte === 93) depth--;
    else if ((byte === 44 || byte === 58) && ++tokens > 4096) throw ingestionError(400, 'json_too_complex');
  }
}

export function readBoundedJson(req, limit, onBytes, timeoutMs = INGESTION_LIMITS.timeoutMs) {
  return new Promise((resolve, reject) => {
    let size = 0,
      used = 0;
    const parts = [];
    const finish = (error, value) => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', failed);
      req.off('aborted', aborted);
      if (error) req.pause();
      parts.length = 0;
      if (error) reject(error);
      else resolve(value);
    };
    const failed = () => finish(ingestionError(400, 'incomplete_body'));
    const aborted = failed;
    const data = (chunk) => {
      size += chunk.length;
      onBytes(size);
      if (size > limit) return finish(ingestionError(413, 'payload_too_large'));
      // Coalesce tiny network chunks: one retained Buffer object per 64 KiB slab.
      // Retaining every incoming chunk would let a slow sender amplify metadata.
      let offset = 0;
      while (offset < chunk.length) {
        if (!parts.length || used === parts.at(-1).length) {
          parts.push(Buffer.allocUnsafe(Math.min(64 * 1024, limit - (size - chunk.length + offset))));
          used = 0;
        }
        const count = chunk.copy(parts.at(-1), used, offset);
        offset += count;
        used += count;
      }
    };
    const end = () => {
      let value;
      try {
        const bytes = Buffer.concat(
          parts.map((part, i) => (i === parts.length - 1 ? part.subarray(0, used) : part)),
          size,
        );
        checkStructure(bytes);
        value = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        return finish(error.status ? error : ingestionError(400, 'invalid_json'));
      }
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return finish(ingestionError(400, 'invalid_json'));
      finish(null, value);
    };
    const timer = setTimeout(() => finish(ingestionError(408, 'body_timeout')), timeoutMs);
    timer.unref();
    req.on('data', data);
    req.once('end', end);
    req.once('error', failed);
    req.once('aborted', aborted);
    if (req.aborted || req.destroyed) failed();
  });
}
