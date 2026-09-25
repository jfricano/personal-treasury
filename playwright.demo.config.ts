import { defineConfig } from '@playwright/test';

// End-to-end tests against the production demo build (sample data, tab-scoped storage).
// Uses the installed Google Chrome, as GitHub's Ubuntu runners and most Macs have it.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-demo-results.json' }]],
  use: { baseURL: 'http://localhost:4174', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run build:demo && npx vite preview --mode demo',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
