import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  BODY_LIMITS,
  INGESTION_LIMITS,
  requestPolicy,
  createIngestionBudget,
  checkBodyHeaders,
  readBoundedJson,
} from '../../sync-server/ingestion.mjs';

const rejected = (action, status) => assert.throws(action, (error) => error.status === status);

test('T-01 byte caps cover each route family and reject unsupported methods and route prefixes', () => {
  const cases = [
    ['/api/auth/login', 'POST', BODY_LIMITS.control, 'public'],
    ['/api/setup/confirm', 'POST', BODY_LIMITS.control, 'setup'],
    ['/api/auth/factor', 'POST', BODY_LIMITS.passkey, 'pending'],
    ['/api/auth/passkeys/verify', 'POST', BODY_LIMITS.passkey, 'session'],
    ['/api/sync/head', 'PUT', BODY_LIMITS.snapshot, 'session'],
    ['/api/migration/versions/1', 'PUT', BODY_LIMITS.snapshot, 'session'],
    ['/api/review/11111111-1111-4111-8111-111111111111', 'PUT', BODY_LIMITS.review, 'session'],
    ['/api/vault', 'PUT', BODY_LIMITS.vault, 'session'],
  ];
  for (const [url, method, limit, auth] of cases) {
    assert.equal(requestPolicy(url, method).limit, limit);
    assert.equal(requestPolicy(url, method).auth, auth);
    checkBodyHeaders(
      { headers: { 'content-length': String(limit), 'content-type': 'application/json' } },
      limit,
    );
    rejected(() => checkBodyHeaders({ headers: { 'content-length': String(limit + 1) } }, limit), 413);
  }
  for (const [url, method] of [
    ['/api/unknown', 'PUT'],
    ['/api/auth/factor/unknown', 'POST'],
    ['/api/auth/login', 'PUT'],
    ['/api/sync/versions/0', 'GET'],
    ['/api/vault', 'DELETE'],
  ])
    assert.equal(requestPolicy(url, method), null);
  assert.equal(requestPolicy('/api/sync/head', 'PUT', true).auth, 'legacy');
  assert.equal(requestPolicy('/api/sync/prune', 'POST', true), null);
});

test('T-01 parser measures received bytes without trusting length; exact, chunked, UTF-8, malformed and complexity boundaries', async () => {
  for (const [input, limit, expected] of [
    ['{"a":1}', 7, 200],
    ['{"a":1} ', 7, 413],
    ['{"a":"é"}', 9, 413],
    ['{', 7, 400],
    ['[]', 7, 400],
    ['{"x":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}', 1000, 400],
  ]) {
    const req = new PassThrough();
    let received = 0;
    const parsed = readBoundedJson(req, limit, (bytes) => {
      received = bytes;
    });
    // A chunk may cross the cap. It must be rejected before retention/concatenation.
    req.end(Buffer.from(input));
    if (expected === 200) assert.deepEqual(await parsed, { a: 1 });
    else await assert.rejects(parsed, (error) => error.status === expected);
    assert.equal(received, Buffer.byteLength(input));
    assert.equal(req.listenerCount('data'), 0);
    assert.equal(req.listenerCount('aborted'), 0);
  }
  const req = new PassThrough();
  const parsed = readBoundedJson(req, 8, () => {});
  req.write('{"a":');
  req.write('1234'); // over the cap without end()
  await assert.rejects(parsed, (error) => error.status === 413);
});

test('T-01 parser releases listeners on timeout, abort and stream error', async () => {
  for (const mode of ['timeout', 'abort', 'error']) {
    const req = new PassThrough();
    const parsed = readBoundedJson(req, 100, () => {}, 10);
    const keepAlive = setTimeout(() => {}, 30);
    if (mode === 'abort') req.emit('aborted');
    if (mode === 'error') req.emit('error', new Error('synthetic'));
    await assert.rejects(parsed, (error) => error.status === (mode === 'timeout' ? 408 : 400));
    clearTimeout(keepAlive);
    assert.equal(req.listenerCount('data'), 0);
  }
});

test('T-01 reservations bound simultaneous readers, retained bytes and queued work; cleanup is idempotent', () => {
  const budget = createIngestionBudget();
  const a = budget.acquire(BODY_LIMITS.snapshot),
    b = budget.acquire(BODY_LIMITS.snapshot);
  rejected(() => budget.acquire(1), 503);
  a.uploaded();
  b.uploaded();
  rejected(() => budget.acquire(1), 503); // parsed work still reserves full cap
  a.release();
  a.release();
  b.release();
  const uploads = Array.from({ length: INGESTION_LIMITS.uploads }, () => budget.acquire(1));
  rejected(() => budget.acquire(1), 503);
  uploads.forEach((lease) => lease.uploaded());
  const queued = Array.from({ length: INGESTION_LIMITS.requests - uploads.length }, () => budget.acquire(0));
  rejected(() => budget.acquire(0), 503);
  [...uploads, ...queued].forEach((lease) => lease.release());
  budget.acquire(BODY_LIMITS.snapshot).release();
});

test('T-01 coalesces one-byte chunks while preserving content and rejects invalid capacity configuration', async () => {
  const req = new PassThrough();
  const parsed = readBoundedJson(req, 128 * 1024, () => {});
  const input = JSON.stringify({ ciphertext: 'a'.repeat(70 * 1024) });
  for (const byte of Buffer.from(input)) req.write(Buffer.from([byte]));
  req.end();
  assert.deepEqual(await parsed, JSON.parse(input));
  for (const override of [
    { requests: 0 },
    { uploads: 5 },
    { bytes: 32 * 1024 ** 2 - 1 },
    { bytes: 64 * 1024 ** 2 + 1 },
  ])
    assert.throws(
      () => createIngestionBudget({ ...INGESTION_LIMITS, ...override }),
      /Invalid ingestion limits/,
    );
});
