// Capture only the fictional local demo. Run npm run dev:demo -- --port 1430 first.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
  await page.goto('http://127.0.0.1:1430/#/analysis');
  await page.getByRole('button', { name: 'Try a sample review' }).click();
  await page.getByText('7 posted transactions').waitFor();
  await page
    .locator('.toast button')
    .click()
    .catch(() => undefined);
  await mkdir('docs/screenshots/v3', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/v3/transactions.png', fullPage: true });
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/v3/summary.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Coverage', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/v3/phone-coverage.png', fullPage: true });
} finally {
  await browser.close();
}
