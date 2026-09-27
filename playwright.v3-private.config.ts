import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e-v3-private',
  timeout: 90000,
  workers: 1,
  use: { baseURL: 'http://localhost:8788', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run build:private && node scripts/preview-private.mjs',
    port: 8788,
    reuseExistingServer: false,
    timeout: 180000,
  },
});
