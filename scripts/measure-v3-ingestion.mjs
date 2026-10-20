// Disposable, synthetic measurement. The service runs in its own process so client
// allocations do not contaminate RSS. Does not read environment service secrets.
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { once } from 'node:events';
import { createV3Server, totp } from '../sync-server/v3.mjs';

if (process.argv.includes('--worker')) {
  let server,
    clock = Date.parse('2026-10-19T12:00:00Z');
  process.on('message', async (message) => {
    if (message.type === 'start') {
      server = await createV3Server({ ...message.config, now: () => clock, requestLogger: () => {} });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      process.send({ port: server.address().port });
    } else if (message.type === 'tick') {
      clock += 7000;
      process.send({ clock });
    } else if (message.type === 'memory') {
      process.send({ ...process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024 });
    } else if (message.type === 'stop') {
      process.send({ stopped: true });
      server.close(() => process.exit(0));
      server.closeAllConnections();
    }
  });
} else {
  const single = process.argv.includes('--single');
  const directory = await mkdtemp(path.join(tmpdir(), 'pt-ingestion-memory-'));
  const child = fork(fileURLToPath(import.meta.url), ['--worker'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const rpc = async (message) => {
    const reply = once(child, 'message');
    child.send(message);
    return (await reply)[0];
  };
  try {
    const setupSecret = randomBytes(32).toString('base64url');
    const { port } = await rpc({
      type: 'start',
      config: {
        dataDirectory: directory,
        ...(single ? { ingestionLimits: { requests: 16, uploads: 1, bytes: 32 * 1024 ** 2 } } : {}),
        origin: 'http://localhost',
        setupSecret,
        ...Object.fromEntries(
          ['pepper', 'atRestKey', 'deviceCookieKey', 'logKey'].map((key) => [
            key,
            randomBytes(32).toString('base64'),
          ]),
        ),
      },
    });
    let cookies = '';
    const headers = () => ({
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
      'X-PT-Request': '1',
      Cookie: cookies,
    });
    const call = async (url, body, extra = {}) => {
      await rpc({ type: 'tick' });
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method: body ? 'POST' : 'GET',
        headers: { ...headers(), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      for (const cookie of res.headers.getSetCookie()) {
        const part = cookie.split(';')[0],
          name = part.split('=')[0];
        cookies = cookies
          .split('; ')
          .filter((c) => !c.startsWith(name + '='))
          .concat(part)
          .filter(Boolean)
          .join('; ');
      }
      if (!res.ok) throw new Error(`Synthetic request failed: ${res.status}`);
      return res.json();
    };
    const credentials = {
      userId: 'memory-fixture',
      authKey: randomBytes(32).toString('base64'),
      salt: randomBytes(32).toString('base64'),
      params: { m: 65536, t: 3, p: 1 },
      wrapped: { iv: 'synthetic', ciphertext: 'synthetic' },
      kid: '1',
    };
    const setupHeaders = { Authorization: `Bearer ${setupSecret}`, Origin: 'tauri://localhost' };
    const begin = await call('/api/setup/begin', credentials, setupHeaders);
    let bits = 0,
      value = 0;
    const bytes = [];
    for (const c of begin.totpSecret) {
      value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    const secret = Buffer.from(bytes).toString('base64');
    const clock = (await rpc({ type: 'tick' })).clock + 7000;
    await call(
      '/api/setup/confirm',
      { enrollment: begin.enrollment, code: totp(secret, Math.floor(clock / 30000)) },
      setupHeaders,
    );
    await call('/api/auth/login', credentials);
    await call('/api/auth/factor', { method: 'recovery', code: begin.recoveryCodes[0] });
    const baseline = await rpc({ type: 'memory' });
    const cap = 32 * 1024 ** 2;
    const body = JSON.stringify({
      envelope: {
        v: 2,
        purpose: 'snapshot',
        ref: 'treasury',
        rev: 1,
        kid: '1',
        nonce: 'synthetic',
        iv: 'synthetic',
        ciphertext: 'a'.repeat(cap - 1024),
      },
    });
    const startUpload = async () => {
      let req;
      const response = new Promise((resolve, reject) => {
        req = request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/sync/head',
            method: 'PUT',
            headers: { ...headers(), 'If-Match': '"0"', 'Content-Length': Buffer.byteLength(body) },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
      });
      for (let offset = 0; offset < body.length - 1; offset += 65536)
        if (!req.write(body.slice(offset, Math.min(offset + 65536, body.length - 1))))
          await once(req, 'drain');
      return { req, response };
    };
    const a = await startUpload(),
      b = single ? null : await startUpload();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const uploading = await rpc({ type: 'memory' });
    a.req.end(body.slice(-1));
    b?.req.end(body.slice(-1));
    const statuses = await Promise.all(b ? [a.response, b.response] : [a.response]);
    if (statuses.sort().join(',') !== (single ? '200' : '200,409'))
      throw new Error('Conditional write regression');
    await call('/api/sync/versions/1');
    const completed = await rpc({ type: 'memory' });
    console.log(
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          wireBytesPerUpload: Buffer.byteLength(body),
          concurrentUploads: single ? 1 : 2,
          statuses,
          baseline,
          uploading,
          completed,
        },
        null,
        2,
      ),
    );
  } finally {
    await rpc({ type: 'stop' }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}
