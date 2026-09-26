import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

function metadata(version) {
  return {
    revision: version.revision,
    createdAt: version.createdAt,
    label: version.label,
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function tokenMatches(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = createHash('sha256').update(header.slice(7)).digest();
  const expected = createHash('sha256').update(token).digest();
  return timingSafeEqual(supplied, expected);
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    return { error: 415 };
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { error: 413 };
  const parts = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return { error: 413 };
      parts.push(chunk);
    }
    return { value: JSON.parse(Buffer.concat(parts).toString('utf8')) };
  } catch {
    return { error: 400 };
  }
}

async function atomicJson(destination, value) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, destination);
}

async function immutableJson(destination, value) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    // link fails if the revision already exists, and publishes only a complete file.
    await link(temporary, destination);
  } finally {
    await unlink(temporary);
  }
}

function versionPath(directory, revision) {
  return path.join(directory, 'versions', `${revision}.json`);
}

async function loadVersions(directory) {
  const versionsDirectory = path.join(directory, 'versions');
  await mkdir(versionsDirectory, { recursive: true, mode: 0o700 });
  const names = await readdir(versionsDirectory);
  const revisions = names
    .filter((name) => /^[1-9]\d*\.json$/.test(name))
    .map((name) => Number(name.slice(0, -5)))
    .sort((a, b) => a - b);
  const versions = [];
  for (let i = 0; i < revisions.length; i += 1) {
    if (revisions[i] !== i + 1) throw new Error('Snapshot history has a missing revision');
    const item = JSON.parse(await readFile(versionPath(directory, revisions[i]), 'utf8'));
    if (
      item.revision !== revisions[i] ||
      typeof item.createdAt !== 'string' ||
      !('envelope' in item) ||
      typeof item.envelope !== 'object' ||
      item.envelope === null ||
      Array.isArray(item.envelope)
    ) {
      throw new Error('Snapshot history contains an invalid version');
    }
    versions.push(metadata(item));
  }
  const headPath = path.join(directory, 'head.json');
  let recordedHead = 0;
  try {
    const current = JSON.parse(await readFile(headPath, 'utf8'));
    recordedHead = current.revision;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!Number.isSafeInteger(recordedHead) || recordedHead < 0 || recordedHead > versions.length) {
    throw new Error('Snapshot head is invalid');
  }
  if (recordedHead < versions.length) {
    // A crash may occur after an immutable version is written but before head.json is replaced.
    // Publishing that complete version avoids reusing its revision on the next write.
    await atomicJson(headPath, versions.at(-1));
  }
  return versions;
}

function parseOrigins(value) {
  if (!value) return new Set();
  const allowed = new Set();
  for (const raw of value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)) {
    if (raw === '*') throw new Error('PT_ALLOWED_ORIGINS cannot contain a wildcard');
    if (!/^[a-z][a-z\d+.-]*:\/\/[^/?#]+$/i.test(raw))
      throw new Error(`Invalid PT_ALLOWED_ORIGINS entry: ${raw}`);
    const parsed = new URL(raw);
    const normalized = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
    if (normalized !== raw) throw new Error(`Invalid PT_ALLOWED_ORIGINS entry: ${raw}`);
    allowed.add(normalized);
  }
  return allowed;
}

async function serveStatic(request, response, staticDirectory) {
  if (!staticDirectory || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return json(response, 404, { error: 'not_found' });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return json(response, 400, { error: 'bad_request' });
  }
  if (pathname.split('/').some((part) => part.startsWith('.') || part === '..')) {
    return json(response, 404, { error: 'not_found' });
  }
  const root = await realpath(staticDirectory);
  let target = path.resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return json(response, 404, { error: 'not_found' });
  }
  let fileInfo;
  try {
    fileInfo = await stat(target);
    if (fileInfo.isDirectory()) target = path.join(target, 'index.html');
    fileInfo = await stat(target);
  } catch {
    if (path.extname(pathname)) return json(response, 404, { error: 'not_found' });
    target = path.join(root, 'index.html');
    try {
      fileInfo = await stat(target);
    } catch {
      return json(response, 404, { error: 'not_found' });
    }
  }
  if (!fileInfo.isFile()) return json(response, 404, { error: 'not_found' });
  const actual = await realpath(target);
  if (!actual.startsWith(`${root}${path.sep}`)) return json(response, 404, { error: 'not_found' });
  response.writeHead(200, {
    'Cache-Control': path.basename(target) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
    'Content-Length': fileInfo.size,
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(target).pipe(response);
}

/** Construct a snapshot API. The returned server does not listen until listen() is called. */
export async function createSyncServer({ token, dataDirectory, allowedOrigins = '', staticDirectory } = {}) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('PT_SYNC_TOKEN must be set to at least 32 random characters');
  }
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim()) {
    throw new Error('PT_SYNC_DATA_DIR must be set');
  }
  const origins = parseOrigins(allowedOrigins);
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  let versions = await loadVersions(dataDirectory);
  let writes = Promise.resolve();

  return http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/healthz' && request.method === 'GET') return json(response, 200, { status: 'ok' });
      if (!pathname.startsWith('/api/')) return await serveStatic(request, response, staticDirectory);

      const origin = request.headers.origin;
      if (origin) {
        response.setHeader('Vary', 'Origin');
        if (!origins.has(origin)) return json(response, 403, { error: 'origin_forbidden' });
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Max-Age': '600',
        });
        return response.end();
      }
      if (!tokenMatches(request.headers.authorization, token)) {
        return json(response, 401, { error: 'unauthorized' });
      }
      if (pathname === '/api/sync/head' && request.method === 'GET') {
        return json(response, 200, versions.at(-1) ?? { revision: 0, createdAt: null, label: null });
      }
      if (pathname === '/api/sync/versions' && request.method === 'GET') {
        return json(response, 200, [...versions].reverse());
      }
      const versionMatch = /^\/api\/sync\/versions\/([1-9]\d*)$/.exec(pathname);
      if (versionMatch && request.method === 'GET') {
        const revision = Number(versionMatch[1]);
        if (!Number.isSafeInteger(revision) || revision > versions.length) {
          return json(response, 404, { error: 'not_found' });
        }
        const version = JSON.parse(await readFile(versionPath(dataDirectory, revision), 'utf8'));
        return json(response, 200, version);
      }
      if (pathname === '/api/sync/head' && request.method === 'PUT') {
        const match = /^"(0|[1-9]\d*)"$/.exec(request.headers['if-match'] ?? '');
        if (!match || !Number.isSafeInteger(Number(match[1]))) {
          return json(response, 428, { error: 'if_match_required' });
        }
        const body = await readJsonBody(request);
        if (body.error)
          return json(response, body.error, {
            error: body.error === 413 ? 'payload_too_large' : 'invalid_json',
          });
        const value = body.value;
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          !value.envelope ||
          typeof value.envelope !== 'object' ||
          Array.isArray(value.envelope) ||
          (value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 120))
        ) {
          return json(response, 400, { error: 'invalid_snapshot' });
        }
        const expected = Number(match[1]);
        const operation = writes.then(async () => {
          const current = versions.at(-1) ?? { revision: 0, createdAt: null, label: null };
          if (current.revision !== expected)
            return { status: 409, value: { error: 'revision_conflict', head: current } };
          const version = {
            revision: current.revision + 1,
            createdAt: new Date().toISOString(),
            label: value.label ?? null,
            envelope: value.envelope,
          };
          try {
            await immutableJson(versionPath(dataDirectory, version.revision), version);
            await atomicJson(path.join(dataDirectory, 'head.json'), metadata(version));
            versions.push(metadata(version));
            return { status: 200, value: metadata(version) };
          } catch (error) {
            versions = await loadVersions(dataDirectory);
            throw error;
          }
        });
        writes = operation.then(
          () => undefined,
          () => undefined,
        );
        const result = await operation;
        return json(response, result.status, result.value);
      }
      return json(response, 404, { error: 'not_found' });
    } catch {
      // Avoid logging request bodies or snapshot metadata, which may contain personal data.
      if (!response.headersSent) json(response, 500, { error: 'internal_error' });
      else response.destroy();
    }
  });
}

export async function startFromEnv(environment = process.env) {
  const server = await createSyncServer({
    token: environment.PT_SYNC_TOKEN,
    dataDirectory: environment.PT_SYNC_DATA_DIR,
    allowedOrigins: environment.PT_ALLOWED_ORIGINS,
    staticDirectory: environment.PT_STATIC_DIR,
  });
  const port = Number(environment.PORT ?? environment.PT_SYNC_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const host = environment.PT_SYNC_HOST ?? '127.0.0.1';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startFromEnv()
    .then((server) => {
      const address = server.address();
      console.log(`Personal Treasury sync listening on ${address.address}:${address.port}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
