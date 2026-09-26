import { expect, test, type Download, type Page } from '@playwright/test';

// The sample data is dated relative to "today"; pin the clock so amounts and months are exact.
const TODAY = new Date('2026-09-24T10:00:00');
const SHOTS = 'test-results/screens-demo';

test.beforeEach(async ({ page }, testInfo) => {
  await page.clock.setFixedTime(TODAY);
  // The guided tour starts on a first visit; other tests behave as returning visitors.
  if (!testInfo.tags.includes('@first-visit'))
    await page.context().addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
  await page.goto('/#/dashboard');
  await expect(page.getByRole('region', { name: 'Demo' })).toContainText('The Harper household');
});

const summary = (page: Page, key: string) =>
  page.getByRole('group', { name: 'Summary' }).getByRole('button', { name: new RegExp(key, 'i') });
const badge = (page: Page) => page.locator('.page-head .badge').first();
const banner = (page: Page) => page.getByRole('region', { name: 'Demo' });

async function confirmBanner(page: Page, button: string, confirm: string) {
  await banner(page).getByRole('button', { name: button }).click();
  await page.getByRole('dialog').getByRole('button', { name: confirm }).click();
}

test('sample data → reload keeps changes → start blank → undo → reset', async ({ page }) => {
  await expect(summary(page, '^Month')).toContainText('September 2026');
  await expect(summary(page, 'Expected cash')).toContainText('$4,690.96');
  await expect(summary(page, 'Non-zero debts')).toContainText('4');
  await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');
  await expect(badge(page)).toHaveText(/Ready to transfer/);
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

  // A change survives a reload of the same tab.
  await page.getByRole('link', { name: 'Interaccount debts' }).click();
  await page
    .getByRole('table', { name: 'Debt detail' })
    .getByRole('button', { name: 'H-04', exact: true })
    .click();
  const drawer = page.getByRole('complementary', { name: 'Loan H-04' });
  await drawer.getByRole('button', { name: 'Record payment' }).click();
  const dlg = page.getByRole('dialog', { name: 'Record payment' });
  await dlg.getByLabel('Payment amount').fill('150');
  await dlg.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByTestId('debt-total')).toHaveText('$635.00');
  await page.reload();
  await expect(page.getByTestId('debt-total')).toHaveText('$635.00');
  await page.getByRole('complementary', { name: 'Loan H-04' }).getByRole('button', { name: 'Close' }).click();

  // Clean slate, then undo it.
  await confirmBanner(page, 'Start blank', 'Start blank');
  await expect(page.getByRole('heading', { name: 'Welcome to Personal Treasury' })).toBeVisible();
  await expect(page.getByText('All data stays in this browser tab.')).toBeVisible();
  await page.getByRole('button', { name: /Undo: Start blank/ }).click();
  await page.getByRole('link', { name: 'Interaccount debts' }).click();
  await expect(page.getByTestId('debt-total')).toHaveText('$635.00');

  // Reset returns to the original sample.
  await confirmBanner(page, 'Reset sample data', 'Reset to sample data');
  await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');

  // A new tab starts from the sample, independent of this one.
  const other = await page.context().newPage();
  await other.clock.setFixedTime(TODAY);
  await other.goto('/#/dashboard');
  await expect(summary(other, 'Total debt outstanding')).toContainText('$785.00');
});

test('allocation change → Review → undo; keyboard transfer settles a debt; mark done → complete → close', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Monthly reconciliation' }).click();
  await expect(page.getByRole('combobox', { name: 'Month' })).toContainText('September 2026');
  await expect(badge(page)).toHaveText(/Ready to transfer/);

  const hh = page.getByLabel('Household budget allocation');
  await hh.click();
  await hh.fill('3200');
  await hh.press('Enter');
  await expect(page.getByText(/Allocations exceed expected cash by \$63\.00/)).toBeVisible();
  await expect(badge(page)).toHaveText(/Review/);
  await page.getByRole('button', { name: /Undo: Edit allocation/ }).click();
  await expect(badge(page)).toHaveText(/Ready to transfer/);

  // ENT owes KIDS $35 on H-03 (an overpayment reversed it). Settle it from the keyboard.
  const row = page.getByRole('row', { name: 'New transfer' });
  await row.getByLabel('Loan ID').fill('H-03');
  await row.getByLabel('Description').fill('Settle cleats credit');
  await row.getByLabel('From account').fill('Entertainment');
  await row.getByLabel('To account').fill('Kids');
  await row.getByLabel('Amount').fill('35');
  await row.getByLabel('Notes').fill('e2e');
  await row.getByLabel('Notes').press('Enter');
  const journal = page.getByRole('table', { name: 'Transfer journal' });
  await expect(journal.getByText('Settle cleats credit')).toBeVisible();
  const accounts = page.getByRole('table', { name: 'Account transfer summary' });
  await expect(accounts.getByRole('row', { name: /^Entertainment/ })).toContainText('$478.96');
  await expect(accounts.getByRole('row', { name: /^Kids/ })).toContainText('$320.00');

  await journal.getByRole('button', { name: /Record on Loan H-03: \+?\$35\.00/ }).click();
  await expect(journal.getByRole('button', { name: /Loan H-03 \+?\$35\.00/ })).toBeVisible();

  const selects = accounts.getByRole('combobox');
  const n = await selects.count();
  for (let i = 0; i < n; i++) await selects.nth(i).selectOption('done');
  await expect(badge(page)).toHaveText(/Complete/);
  await page.screenshot({ path: `${SHOTS}/monthly-complete.png`, fullPage: true });

  await page.getByRole('button', { name: 'Close month' }).click();
  await expect(page.getByText(/is closed and read-only/)).toBeVisible();
  await expect(page.getByRole('row', { name: 'New transfer' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Interaccount debts' }).click();
  await expect(page.getByTestId('debt-count')).toHaveText('3');
  await expect(page.getByTestId('debt-total')).toHaveText('$750.00');
});

test('record a payoff, then overpay and see the direction reverse', async ({ page }) => {
  await page.getByRole('link', { name: 'Interaccount debts' }).click();
  const detail = page.getByRole('table', { name: 'Debt detail' });

  await detail.getByRole('button', { name: 'H-01', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Loan H-01' });
  await expect(drawer).toContainText('Pets etc. owes Long-term savings $300.00');
  await drawer.getByRole('button', { name: 'Record payment' }).click();
  const dlg = page.getByRole('dialog', { name: 'Record payment' });
  await dlg.getByLabel('Payment amount').fill('300');
  await expect(dlg).toContainText('This pays the debt off');
  await dlg.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByTestId('debt-count')).toHaveText('3');
  await expect(page.getByTestId('debt-total')).toHaveText('$485.00');
  await drawer.getByRole('button', { name: 'Close' }).click();

  // Overpay H-05 (Travel owes Long-term savings $300) by paying $400: LTS now owes TRV $100.
  await detail.getByRole('button', { name: 'H-05', exact: true }).click();
  const d5 = page.getByRole('complementary', { name: 'Loan H-05' });
  await d5.getByRole('button', { name: 'Record payment' }).click();
  const dlg5 = page.getByRole('dialog', { name: 'Record payment' });
  await dlg5.getByLabel('Payment amount').fill('400');
  await expect(dlg5).toContainText('The direction reverses: Long-term savings owes Travel $100.00');
  await dlg5.getByRole('button', { name: 'Save payment' }).click();
  await expect(d5).toContainText('Long-term savings owes Travel $100.00');
  await expect(page.getByTestId('debt-total')).toHaveText('$285.00');
  await page.screenshot({ path: `${SHOTS}/debt-drawer.png`, fullPage: true });
});

test('budget plan shows take-home, funding and a labelled tax estimate', async ({ page }) => {
  await page.getByRole('link', { name: 'Budget and tax' }).click();
  await expect(page.getByText('After the raise').first()).toBeVisible();
  await expect(page.getByText('$4,690.96').first()).toBeVisible();
  await expect(page.getByText('Spring plan').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/budget.png`, fullPage: true });
});

test('JSON backup → start blank → restore; Excel export → start blank → import', async ({
  page,
}, testInfo) => {
  await page.getByRole('link', { name: 'Import and export' }).click();
  const backupDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Complete JSON backup' }).click();
  const backup = testInfo.outputPath('backup.json');
  await (await backupDl).saveAs(backup);
  const excelDownloads: Download[] = [];
  page.on('download', (download) => excelDownloads.push(download));
  await page.getByRole('button', { name: 'Excel workbooks' }).click();
  await expect.poll(() => excelDownloads.length).toBe(2);
  expect(excelDownloads.map((download) => download.suggestedFilename())).toEqual([
    expect.stringMatching(/^Personal Treasury export .*\.xlsx$/),
    expect.stringMatching(/^Personal Budget export .*\.xlsx$/),
  ]);
  const workbook = testInfo.outputPath('export.xlsx');
  await excelDownloads[0].saveAs(workbook);

  // Restore the JSON backup over a blank database. The demo has no profiles to restore into.
  await confirmBanner(page, 'Start blank', 'Start blank');
  await page.getByRole('link', { name: 'Import and export' }).click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose backup…' }).click();
  await (await chooser).setFiles(backup);
  await expect(page.getByRole('button', { name: 'Restore into new profile' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Replace demo data…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Replace current data' }).click();
  await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');

  // Import the Excel export into a blank database.
  await confirmBanner(page, 'Start blank', 'Start blank');
  await page.getByRole('button', { name: /Import workbook/ }).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose workbook…' }).click();
  await (await chooser).setFiles(workbook);
  await expect(page.getByTestId('controls-result')).toHaveText(/All \d+ pass/);
  await page.getByRole('button', { name: 'Commit import' }).click();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(summary(page, 'Non-zero debts')).toContainText('4');
  await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');
});

test(
  'guided tour: starts once on a first visit, walks every page, and can be relaunched',
  { tag: '@first-visit' },
  async ({ page }) => {
    const tour = (title: string | RegExp) => page.getByRole('dialog', { name: title });
    await expect(tour('Welcome to the Harpers’ treasury')).toBeVisible();
    await tour('Welcome to the Harpers’ treasury').getByRole('button', { name: 'Show me' }).click();
    await expect(tour('This month at a glance')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(tour('Where each dollar goes')).toBeVisible();
    await expect(page).toHaveURL(/#\/monthly/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(tour('Nothing hides')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(tour('Moves between buckets')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(tour('What the buckets owe each other')).toBeVisible();
    await expect(page).toHaveURL(/#\/debts/);
    await page.keyboard.press('ArrowRight');
    await expect(tour('Budgets drive each month')).toBeVisible();
    await expect(page).toHaveURL(/#\/budget/);
    await page.keyboard.press('ArrowRight');
    await expect(tour('Your turn')).toContainText('8 of 8');
    await page.screenshot({ path: `${SHOTS}/tour-last.png` });
    await tour('Your turn').getByRole('button', { name: 'Start exploring' }).click();
    await expect(page.locator('.tour')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/dashboard/);

    // Once seen, it stays closed; the banner relaunches it and Escape closes it.
    await page.reload();
    await expect(banner(page)).toBeVisible();
    await expect(page.locator('.tour')).toHaveCount(0);
    await banner(page).getByRole('button', { name: 'Take the tour' }).click();
    await expect(tour('Welcome to the Harpers’ treasury')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tour')).toHaveCount(0);
    await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');
  },
);

test('sample workbook: download → start blank → import with every control passing', async ({
  page,
}, testInfo) => {
  await page.getByRole('link', { name: 'Import and export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download the sample household's workbook/ }).click();
  const file = testInfo.outputPath('Harper household workbook.xlsx');
  await (await download).saveAs(file);
  expect((await download).suggestedFilename()).toBe('Harper household workbook.xlsx');

  await confirmBanner(page, 'Start blank', 'Start blank');
  await page.getByRole('button', { name: /Import workbook/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose workbook…' }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('controls-result')).toHaveText(/All \d+ pass/);
  await page.getByRole('button', { name: 'Commit import' }).click();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(summary(page, 'Non-zero debts')).toContainText('4');
  await expect(summary(page, 'Total debt outstanding')).toContainText('$785.00');
});

test('sample budget workbook downloads and imports as the current plan', async ({ page }, testInfo) => {
  await page.getByRole('link', { name: 'Import and export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: "Download the sample household's budget workbook" }).click();
  const file = testInfo.outputPath('sample-budget.xlsx');
  await (await download).saveAs(file);
  await confirmBanner(page, 'Start blank', 'Start blank');
  await page.getByRole('button', { name: /Import workbook/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose budget workbook…' }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('table', { name: 'Budget versions to import' })).toContainText(
    'After the raise',
  );
  await expect(page.getByTestId('budget-controls-result')).toContainText(/All \d+ pass/);
  await page.getByRole('button', { name: 'Commit budget import' }).click();
  await page.getByRole('button', { name: 'Open budget' }).click();
  await expect(page.getByText('$4,690.96').first()).toBeVisible();
});

test('review status jumps to the needs review section', async ({ page }) => {
  await page.getByRole('link', { name: 'Monthly reconciliation' }).click();
  await page.getByLabel('Household budget allocation').fill('3200');
  await page.getByLabel('Household budget allocation').press('Enter');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: 'Jump to needs review' }).click();
  await expect
    .poll(async () =>
      page.locator('#dashboard-needs-review').evaluate((el) => Math.round(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(120);
});

test('phone width: pages never scroll sideways; wide tables, drawers and dialogs fit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const main = page.locator('main');
  for (const p of ['dashboard', 'monthly', 'budget', 'debts', 'history', 'accounts', 'import', 'settings']) {
    await page.goto(`/#/${p}`);
    await expect(banner(page)).toBeVisible();
    const [scroll, client] = await main.evaluate((m) => [m.scrollWidth, m.clientWidth]);
    expect(scroll, `${p} scrolls sideways`).toBeLessThanOrEqual(client);
  }
  // The debt table scrolls inside its panel instead.
  await page.goto('/#/debts');
  const body = page.getByRole('region', { name: 'Debt detail' }).locator('.body');
  expect(await body.evaluate((b) => b.scrollWidth > b.clientWidth)).toBe(true);

  await page
    .getByRole('table', { name: 'Debt detail' })
    .getByRole('button', { name: 'H-01', exact: true })
    .click();
  const drawer = page.getByRole('complementary', { name: 'Loan H-01' });
  await expect(drawer).toContainText('Pets etc. owes Long-term savings $300.00');
  expect(await drawer.evaluate((d) => d.getBoundingClientRect().width)).toBeLessThanOrEqual(375);
  await drawer.getByRole('button', { name: 'Record payment' }).click();
  const dlg = page.getByRole('dialog', { name: 'Record payment' });
  const fits = await dlg.evaluate((d) => {
    const b = d.querySelector('.body')!;
    return d.getBoundingClientRect().right <= innerWidth && b.scrollWidth <= b.clientWidth;
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: `${SHOTS}/phone-payment.png` });
});
