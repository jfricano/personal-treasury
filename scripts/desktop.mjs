import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const action = process.argv[2] ?? 'dev';
if (!['dev', 'build'].includes(action)) throw new Error('Use dev or build');
const source = process.env.PT_SERVICE_ORIGIN;
let origin = '';
if (source) {
  const url = new URL(source);
  if (url.origin !== source || url.protocol !== 'https:')
    throw new Error('PT_SERVICE_ORIGIN must be an HTTPS origin without a path');
  origin = source;
}
const variant = origin ? 'Connected' : 'Local';
const productName = `Personal Treasury ${variant}${action === 'dev' ? ' Dev' : ''}`;
// Keep the connected app's identity so existing encrypted data and device keys stay accessible.
const identifier = `${origin ? 'com.personaltreasury.app' : 'com.personaltreasury.app.local'}${action === 'dev' ? '.dev' : ''}`;
const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const config = {
  identifier,
  productName,
  app: {
    windows: base.app.windows.map((window) => ({ ...window, title: productName })),
    security: {
      csp: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; style-src-attr 'none'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost ${origin}; object-src 'none'; base-uri 'none'`,
    },
  },
};
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tauri', action, '--config', JSON.stringify(config), ...process.argv.slice(3)],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 1));
