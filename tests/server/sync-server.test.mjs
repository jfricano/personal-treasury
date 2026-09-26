import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createSyncServer } from '../../sync-server/server.mjs';

const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
const active = [];

async function fixture(options = {}) {
  const directory = options.dataDirectory ?? (await mkdtemp(path.join(os.tmpdir(), 'pt-sync-test-')));
  const server = await createSyncServer({ token, dataDirectory: directory, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  active.push({ server, directory, owner: !options.dataDirectory });
  return { base: `http://127.0.0.1:${server.address().port}`, directory, server };
}

async function request(base, route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

afterEach(async () => {
  for (const item of active.splice(0)) {
    await new Promise((resolve) => item.server.close(resolve));
    if (item.owner) await rm(item.directory, { recursive: true, force: true });
  }
});

test('startup rejects absent or short tokens and data directories', async () => {
  await assert.rejects(createSyncServer({ dataDirectory: os.tmpdir() }), /PT_SYNC_TOKEN/);
  await assert.rejects(createSyncServer({ token: 'short', dataDirectory: os.tmpdir() }), /PT_SYNC_TOKEN/);
  await assert.rejects(createSyncServer({ token }), /PT_SYNC_DATA_DIR/);
});

test('all snapshot reads and writes require the configured token', async () => {
  const { base } = await fixture();
  for (const route of ['/api/sync/head', '/api/sync/versions', '/api/sync/versions/1']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 401);
  }
  const response = await fetch(`${base}/api/sync/head`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
    body: JSON.stringify({ envelope: { ciphertext: 'fake' } }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual((await request(base, '/api/sync/head')).body, {
    revision: 0,
    createdAt: null,
    label: null,
  });
});

test('compare-and-swap prevents overwrites and retains immutable history', async () => {
  const { base, directory } = await fixture();
  const initial = { format: 'test', ciphertext: 'first' };
  const next = { format: 'test', ciphertext: 'second' };
  const missingMatch = await request(base, '/api/sync/head', { method: 'PUT', body: { envelope: initial } });
  assert.equal(missingMatch.status, 428);
  const first = await request(base, '/api/sync/head', {
    method: 'PUT',
    body: { envelope: initial, label: 'Initial backup' },
    headers: { 'If-Match': '"0"' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 1);
  const stale = await request(base, '/api/sync/head', {
    method: 'PUT',
    body: { envelope: next },
    headers: { 'If-Match': '"0"' },
  });
  assert.deepEqual(stale.body, { error: 'revision_conflict', head: first.body });
  assert.equal(stale.status, 409);
  const second = await request(base, '/api/sync/head', {
    method: 'PUT',
    body: { envelope: next },
    headers: { 'If-Match': '"1"' },
  });
  assert.equal(second.body.revision, 2);
  assert.deepEqual((await request(base, '/api/sync/versions')).body, [second.body, first.body]);
  assert.deepEqual((await request(base, '/api/sync/versions/1')).body, { ...first.body, envelope: initial });
  assert.deepEqual((await request(base, '/api/sync/versions/2')).body, { ...second.body, envelope: next });
  assert.equal((await request(base, '/api/sync/versions/3')).status, 404);
  assert.equal(
    JSON.parse(await readFile(path.join(directory, 'versions', '1.json'), 'utf8')).envelope.ciphertext,
    'first',
  );
});

test('simultaneous uploads against one revision accept only one', async () => {
  const { base } = await fixture();
  const upload = (ciphertext) =>
    request(base, '/api/sync/head', {
      method: 'PUT',
      body: { envelope: { ciphertext } },
      headers: { 'If-Match': '"0"' },
    });
  const results = await Promise.all([upload('a'), upload('b')]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await request(base, '/api/sync/versions')).body.length, 1);
});

test('restart preserves history and recovers a fully written orphan version', async () => {
  const { base, directory, server } = await fixture();
  const first = await request(base, '/api/sync/head', {
    method: 'PUT',
    body: { envelope: { ciphertext: 'saved' } },
    headers: { 'If-Match': '"0"' },
  });
  await new Promise((resolve) => server.close(resolve));
  active.splice(
    active.findIndex((item) => item.server === server),
    1,
  );
  await writeFile(
    path.join(directory, 'versions', '2.json'),
    JSON.stringify({
      revision: 2,
      createdAt: '2026-09-25T00:00:00.000Z',
      label: 'Recovered',
      envelope: { ciphertext: 'recovered' },
    }),
  );
  const restarted = await fixture({ dataDirectory: directory });
  const recovered = await request(restarted.base, '/api/sync/head');
  assert.equal(recovered.body.revision, 2);
  assert.equal((await request(restarted.base, '/api/sync/versions/1')).body.envelope.ciphertext, 'saved');
  assert.equal(JSON.parse(await readFile(path.join(directory, 'head.json'), 'utf8')).revision, 2);
  assert.equal(first.body.revision, 1);
  // fixture() was told this directory already existed; clean it explicitly.
  active.at(-1).owner = true;
});

test('CORS allows only configured origins, including Tauri custom scheme', async () => {
  const { base } = await fixture({ allowedOrigins: 'https://treasury.example,tauri://localhost' });
  const allowed = await request(base, '/api/sync/head', { headers: { Origin: 'tauri://localhost' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'tauri://localhost');
  const blocked = await request(base, '/api/sync/head', { headers: { Origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(`${base}/api/sync/head`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://treasury.example', 'Access-Control-Request-Method': 'PUT' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://treasury.example');
});
