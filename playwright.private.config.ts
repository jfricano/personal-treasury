import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dataDirectory = mkdtempSync(path.join(tmpdir(), 'personal-treasury-private-e2e-'));
const token = 'private-e2e-token-0123456789abcdef0123456789abcdef';

export default defineConfig({
  testDir: 'tests/e2e-private',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8787', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run build:private && node sync-server/server.mjs',
    port: 8787,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PT_SYNC_TOKEN: token,
      PT_SYNC_DATA_DIR: dataDirectory,
      PT_STATIC_DIR: path.resolve('dist-private'),
      PT_ALLOWED_ORIGINS: 'http://127.0.0.1:8787',
    },
  },
});
