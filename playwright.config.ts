import { defineConfig } from '@playwright/test';

// End-to-end tests against the personal reference workbooks (tests/local is gitignored).
// Uses the locally installed Google Chrome so no browser download is required.
export default defineConfig({
  testDir: 'tests/local/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: 'http://localhost:1420', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npm run dev', port: 1420, reuseExistingServer: true },
});
