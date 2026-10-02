import { spawn } from 'node:child_process';
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
const config = {
  ...(action === 'dev'
    ? { identifier: 'com.personaltreasury.app.dev', productName: 'Personal Treasury Dev' }
    : {}),
  app: {
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
