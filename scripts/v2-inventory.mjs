import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Run against the production demo preview. Optional second argument is a
// fictional workbook for the import-preview state.
const output = process.argv[2] ?? 'test-results/v2-control-inventory.json';
const sampleWorkbook = process.argv[3];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.clock.setFixedTime(new Date('2026-09-24T10:00:00'));
await page.addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
const routes = ['dashboard', 'monthly', 'budget', 'debts', 'history', 'accounts', 'import', 'settings'];
const inventory = {};
const controls = (scope = 'body') =>
  page
    .locator(
      `${scope} a,${scope} button,${scope} input,${scope} select,${scope} textarea,${scope} [role="button"],${scope} [tabindex]`,
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          name:
            el.getAttribute('aria-label') ||
            (el.labels && [...el.labels].map((l) => l.textContent.trim()).join(' ')) ||
            el.textContent.trim().replace(/\s+/g, ' ').slice(0, 100) ||
            el.getAttribute('title') ||
            el.getAttribute('placeholder') ||
            '(unnamed)',
          disabled: el.disabled || false,
          href: el.getAttribute('href'),
        })),
    );
for (const route of routes) {
  await page.goto(`http://127.0.0.1:4174/#/${route}`);
  await page.getByRole('region', { name: 'Demo' }).waitFor();
  inventory[route] = await controls();
}
await page.goto('http://127.0.0.1:4174/#/dashboard');
await page.getByRole('button', { name: /What to try/ }).click();
inventory['demo:exercises'] = await controls('.demo-banner');
await page.getByRole('button', { name: 'Take the tour' }).click();
await page.getByRole('dialog', { name: 'Welcome to the Harpers’ treasury' }).waitFor();
inventory['demo:tour'] = await controls('.tour');
await page.keyboard.press('Escape');
await page.goto('http://127.0.0.1:4174/#/monthly');
await page.getByRole('button', { name: 'Advanced entry' }).click();
inventory['monthly:advanced-entry'] = await controls('dialog[open]');
await page.setViewportSize({ width: 375, height: 812 });
inventory['monthly:advanced-entry:375'] = await page.evaluate(() => {
  const dialog = document.querySelector('dialog[open]');
  const rect = dialog.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    viewport: innerWidth,
    bodyScroll: document.querySelector('dialog .body').scrollWidth,
  };
});
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'New month' }).click();
inventory['monthly:new-month'] = await controls('dialog[open]');
await page.keyboard.press('Escape');
await page.getByLabel('HH budget allocation').fill('3200');
await page.getByLabel('HH budget allocation').press('Enter');
await page.getByRole('note', { name: 'Budget overrides' }).getByRole('button', { name: 'Review' }).click();
inventory['monthly:refresh-budget'] = await controls('dialog[open]');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Close month' }).click();
inventory['monthly:close-override'] = await controls('dialog[open]');
await page.goto('http://127.0.0.1:4174/#/debts');
await page.getByRole('button', { name: 'New debt' }).click();
inventory['debts:new-debt'] = await controls('dialog[open]');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Record payment' }).click();
inventory['debts:payment'] = await controls('dialog[open]');
await page.keyboard.press('Escape');
await page
  .getByRole('table', { name: 'Debt detail' })
  .getByRole('button', { name: 'H-01', exact: true })
  .click();
await page.getByRole('complementary', { name: 'Loan H-01' }).waitFor();
inventory['debts:loan-drawer'] = await controls('aside.drawer');
await page.goto('http://127.0.0.1:4174/#/budget');
await page
  .getByRole('region', { name: 'Budget history' })
  .getByRole('button', { name: 'New empty draft' })
  .click();
inventory['budget:new-draft'] = await controls('dialog[open]');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Duplicate' }).click();
await page.getByRole('button', { name: /Activate/ }).click();
inventory['budget:activate'] = await controls('dialog[open]');
await page.goto('http://127.0.0.1:4174/#/accounts');
await page.getByRole('button', { name: /alias/ }).first().click();
inventory['accounts:add-alias'] = await controls('dialog[open]');
if (sampleWorkbook) {
  await page.goto('http://127.0.0.1:4174/#/import');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose workbook…' }).click();
  await (await chooser).setFiles(sampleWorkbook);
  await page.getByTestId('controls-result').waitFor();
  inventory['import:preview'] = await controls('main');
}
await page.goto('http://127.0.0.1:4174/#/dashboard');
await page.getByRole('button', { name: 'Start blank' }).click();
inventory['demo:blank-confirm'] = await controls('dialog[open]');
await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();
inventory['dashboard:blank'] = await controls('main');
writeFileSync(output, JSON.stringify(inventory, null, 2));
console.log(
  Object.fromEntries(
    Object.entries(inventory).map(([key, value]) => [key, Array.isArray(value) ? value.length : value]),
  ),
);
await browser.close();
