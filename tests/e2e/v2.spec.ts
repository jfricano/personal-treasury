import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const BASE = '/#/';
const routes = ['dashboard', 'monthly', 'budget', 'debts', 'history', 'accounts', 'import', 'settings'];
const widths = [390, 768, 1024, 1280, 1440];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T10:00:00'));
  await page.addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
  await page.goto(`${BASE}dashboard`);
  await expect(page.getByRole('region', { name: 'Demo' })).toBeVisible();
});

async function fitsViewport(page: Page, selector: string) {
  const bounds = await page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
}

test('V2-01 wide entry and refresh dialogs fit a phone and remain operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  await page.goto(`${BASE}monthly`);
  await page.getByRole('button', { name: 'Advanced entry' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced entry' });
  await fitsViewport(page, 'dialog[open]');
  await advanced.getByLabel('Posting 1 account').fill('Household');
  await advanced.getByLabel('Posting 1 amount').fill('-1');
  await advanced.getByLabel('Posting 2 account').fill('Pets etc.');
  await advanced.getByLabel('Posting 2 amount').fill('1');
  await advanced.getByRole('button', { name: 'Save balanced entry' }).click();
  await expect(page.getByRole('table', { name: 'Transfer journal' })).toContainText(
    'HouseholdPets etc.$1.00',
  );
  await page.getByLabel('Household budget allocation').fill('3200');
  await page.getByLabel('Household budget allocation').press('Enter');
  await page.getByRole('note', { name: 'Budget overrides' }).getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await fitsViewport(page, 'dialog[open]');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

test('V2-02 formula groups keep both controls bounded at every review width', async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}budget`);
    const formula = page.locator('.deduction-formula').first();
    await expect(formula).toBeVisible();
    const shape = await formula.evaluate((el) => {
      const groups = [...el.querySelectorAll('.formula-group')];
      const inputs = [...el.querySelectorAll('input')];
      return {
        groupHeights: groups.map((g) => g.getBoundingClientRect().height),
        inputWidths: inputs.map((i) => i.getBoundingClientRect().width),
      };
    });
    expect(shape.groupHeights).toHaveLength(2);
    expect(
      shape.groupHeights.every((height) => height < 36),
      `${width}px formula split`,
    ).toBe(true);
    expect(shape.inputWidths[0]).toBeLessThan(70);
    expect(shape.inputWidths[1]).toBeLessThan(120);
  }
});

test('formatted money replacement commits exactly the entered value at every width', async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}monthly`);
    const allocation = page.getByLabel('Household budget allocation');
    await allocation.fill('3200');
    await expect(allocation).toHaveValue('3200');
    await allocation.press('Enter');
    await expect(allocation).toHaveValue('3,200.00');
    await page.reload();
    await expect(page.getByLabel('Household budget allocation')).toHaveValue('3,200.00');
  }
});

test('V2-03/04/05 pending, review counts and destination focus stay in sync', async ({ page }) => {
  const pending = page.getByRole('region', { name: 'Transfers to complete' });
  const review = page.getByRole('region', { name: 'Needs review' });
  await expect(pending.locator('li')).toHaveCount(5);
  await expect(pending.locator('header')).toContainText('5 item(s)');
  await expect(review.locator('header')).toContainText('0 item(s)');
  await expect(review).toContainText('Nothing needs attention');
  await pending.getByRole('button', { name: 'Mark Pets etc. done' }).click();
  await expect(page).toHaveURL(/#\/monthly\?.*target=done/);
  await expect(page.getByLabel('Pets etc. transferred')).toBeFocused();
  await page.getByLabel('Pets etc. transferred').selectOption('done');
  await page.goBack();
  await expect(pending.locator('li')).toHaveCount(4);
  await expect(pending.locator('header')).toContainText('4 item(s)');
  await page.getByRole('button', { name: /Undo: Edit allocation/ }).click();
  await expect(pending.locator('li')).toHaveCount(5);
  await page.getByRole('link', { name: 'Monthly reconciliation' }).click();
  await page.getByLabel('Household budget allocation').fill('3200');
  await page.getByLabel('Household budget allocation').press('Enter');
  await expect(page.locator('.page-head .badge').first()).toContainText('Review');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(review.locator('li')).toHaveCount(2);
  const count = await review.locator('li').count();
  await expect(review.locator('header')).toContainText(`${count} item(s)`);
  await review
    .getByRole('button', { name: /^Resolve/ })
    .first()
    .click();
  await expect(page.locator('#month-summary')).toBeFocused();
  await page.goBack();
  await expect(review.locator('li')).toHaveCount(count);
});

test('V2-06/07 debt and tax panels stack at 1280, monthly actions stay grouped', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}debts`);
  const debts = page.locator('.debt-panels > .panel');
  const tops = await debts.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(tops[1]).toBeGreaterThan(tops[0]);
  await page.goto(`${BASE}budget`);
  const panels = page.locator('.budget-overview > .panel');
  const taxTops = await panels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(taxTops[1]).toBeGreaterThan(taxTops[0]);
  for (const width of [390, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}monthly`);
    const actions = page.locator('.monthly-actions');
    await expect(actions.getByRole('button')).toHaveCount(3);
    const rects = await actions.getByRole('button').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top };
      }),
    );
    expect(rects.every((r) => r.left >= 0 && r.right <= width)).toBe(true);
    if (width === 390) expect(rects[2].top).toBeGreaterThan(rects[1].top);
  }
});

test('V2-09 exercise collapses and opens its named debt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  const banner = page.getByRole('region', { name: 'Demo' });
  await banner.getByRole('button', { name: /What to try/ }).click();
  await banner.getByRole('link', { name: /Overpay debt H-05/ }).click();
  await expect(page).toHaveURL(/#\/debts\?.*debt=/);
  await expect(page.getByRole('complementary', { name: 'Loan H-05' })).toBeVisible();
  await expect(banner.getByRole('link', { name: /Overpay debt H-05/ })).toHaveCount(0);
  await page.getByRole('complementary', { name: 'Loan H-05' }).getByRole('button', { name: 'Close' }).click();
  await banner.getByRole('button', { name: /What to try/ }).click();
  await expect(banner.getByRole('link', { name: /Overpay debt H-05/ })).toBeVisible();
});

test('V2-08 date defaults follow the local day around midnight in both directions', async ({ browser }) => {
  for (const scenario of [
    { zone: 'America/Los_Angeles', instant: '2026-09-25T06:30:00Z', day: '2026-09-24' },
    { zone: 'Asia/Tokyo', instant: '2026-09-24T15:30:00Z', day: '2026-09-25' },
  ]) {
    const context = await browser.newContext({ timezoneId: scenario.zone });
    await context.addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
    const local = await context.newPage();
    await local.clock.setFixedTime(new Date(scenario.instant));
    await local.goto(`${BASE}debts`);
    await local.getByRole('button', { name: 'New debt' }).click();
    const debt = local.getByRole('dialog', { name: 'New debt' });
    await expect(debt.getByLabel('Opened date')).toHaveValue(scenario.day);
    await debt.getByLabel('Opened date').fill('2026-01-17');
    await debt.getByLabel('Loan ID').fill('EXPLICIT');
    await expect(debt.getByLabel('Opened date')).toHaveValue('2026-01-17');
    await debt.getByRole('button', { name: 'Cancel' }).click();
    await local.getByRole('button', { name: 'Record payment' }).click();
    await expect(local.getByRole('dialog', { name: 'Record payment' }).getByLabel('Date')).toHaveValue(
      scenario.day,
    );
    await local.goto(`${BASE}monthly`);
    await expect(local.getByRole('row', { name: 'New transfer' }).getByLabel('Date')).toHaveValue(
      scenario.day,
    );
    await context.close();
  }
});

test('V2-10 direct mobile route keeps active nav fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  for (const route of ['debts', 'settings', 'dashboard']) {
    await page.goto(`${BASE}${route}`);
    const active = await page.locator('nav[aria-label="Main"] [aria-current="page"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const nav = el.parentElement!.getBoundingClientRect();
      return { left: r.left, right: r.right, navLeft: nav.left, navRight: nav.right };
    });
    expect(active.left).toBeGreaterThanOrEqual(active.navLeft - 1);
    expect(active.right).toBeLessThanOrEqual(active.navRight + 1);
  }
});

test('account names persist, archived accounts restore, and unused accounts delete', async ({ page }) => {
  await page.goto(`${BASE}accounts`);
  const accountTable = page.getByRole('table', { name: 'Accounts' });
  await expect(page.getByRole('button', { name: 'Add account' })).toBeDisabled();
  await page.getByLabel('New account name').fill('Quality check');
  await page.getByRole('button', { name: 'Add account' }).click();
  let row = accountTable.getByRole('row').filter({ has: page.getByLabel('Quality check name') });
  await expect(row).toBeVisible();
  await page.getByLabel('Quality check name').fill('Quality checks');
  await page.getByLabel('Quality check name').press('Enter');
  row = accountTable.getByRole('row').filter({ has: page.getByLabel('Quality checks name') });
  await page.getByLabel('Quality checks description').fill('Local account test');
  await page.getByLabel('Quality checks description').press('Tab');
  await page.getByRole('button', { name: 'Move Quality checks up' }).click();
  await row.getByRole('checkbox').uncheck();
  await expect(row).toContainText('Archived');
  await page.reload();
  row = accountTable.getByRole('row').filter({ has: page.getByLabel('Quality checks name') });
  await expect(page.getByLabel('Quality checks name')).toHaveValue('Quality checks');
  await expect(page.getByLabel('Quality checks description')).toHaveValue('Local account test');
  await expect(page.getByLabel('Quality checks color')).toHaveCount(0);
  await expect(row.getByRole('checkbox')).not.toBeChecked();
  await row.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Delete Quality checks' }).click();
  await page.getByRole('dialog', { name: 'Please confirm' }).getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: /Undo: Delete account/ }).click();
  await expect(page.getByLabel('Quality checks name')).toHaveValue('Quality checks');
});

test('dashboard summaries and history links reach their destinations', async ({ page }) => {
  const summary = page.getByRole('group', { name: 'Summary' });
  for (const name of ['Month', 'Expected cash', 'Allocation difference', 'Transfers completed']) {
    await summary.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(/#\/monthly/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard/);
  }
  for (const name of ['Non-zero debts', 'Total debt outstanding']) {
    await summary.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(/#\/debts/);
    await page.goBack();
  }
  await page.getByRole('checkbox', { name: 'Show all' }).check();
  await expect(page.getByRole('checkbox', { name: 'Show all' })).toBeChecked();
  await page.getByRole('button', { name: 'Open budget' }).click();
  await expect(page).toHaveURL(/#\/budget/);
  await page.goBack();
  await page.getByRole('button', { name: 'Open debts' }).click();
  await expect(page).toHaveURL(/#\/debts/);
  await page.getByRole('link', { name: 'Budget History' }).click();
  await expect(page.getByRole('heading', { name: 'Budget History' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Budget versions' })).toContainText('Spring plan');
  await page.goto(`${BASE}monthly`);
  await page
    .getByRole('table', { name: 'Month history' })
    .getByRole('button', { name: 'September 2026' })
    .click();
  await expect(page).toHaveURL(/#\/monthly\?.*month=/);
});

test('debt filters, search, date bounds, CSV and reset change visible rows', async ({ page }, testInfo) => {
  await page.goto(`${BASE}debts`);
  const detail = page.getByRole('table', { name: 'Debt detail' });
  const filters = page.getByRole('group', { name: 'Debt state filter' });
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await filters.getByRole('button', { name: 'Paid', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'Paid', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await filters.getByRole('button', { name: 'Credit', exact: true }).click();
  await filters.getByRole('button', { name: 'Review note' }).click();
  await filters.getByRole('button', { name: 'Non-zero' }).click();
  await page.getByLabel('Search debts').fill('H-05');
  await expect(detail.getByRole('row')).toHaveCount(2);
  await expect(detail).toContainText('H-05');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = testInfo.outputPath('v2-debts.csv');
  await (await download).saveAs(csv);
  expect(readFileSync(csv, 'utf8')).toContain('H-05');
  expect(readFileSync(csv, 'utf8')).not.toContain('H-01');
  await page.getByLabel('Search debts').fill('no-such-loan');
  await expect(detail).toContainText('No debts match these filters');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByLabel('Active from').fill('2100-01-01');
  await expect(detail).toContainText('No debts match these filters');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByLabel('Opened by').fill('1900-01-01');
  await expect(detail).toContainText('No debts match these filters');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByLabel('Account filter').selectOption({ label: 'Household' });
  await expect(page.getByRole('region', { name: 'Debt detail' })).toContainText('involving Household');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page
    .getByRole('group', { name: 'Debt summary' })
    .getByRole('button', { name: /Largest debt/ })
    .click();
  await expect(page.getByRole('region', { name: 'Debt detail' })).toContainText('largest');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await detail.getByRole('button', { name: 'H-05', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Loan H-05' })).toBeVisible();
});

test('debt create, payment, correction, adjustment, delete and undo roll balances forward', async ({
  page,
}) => {
  await page.goto(`${BASE}debts`);
  await page.getByRole('button', { name: 'New debt' }).click();
  const create = page.getByRole('dialog', { name: 'New debt' });
  await expect(create.getByRole('button', { name: 'Create debt' })).toBeDisabled();
  await create.getByLabel('Loan ID').fill('H-01');
  await expect(create).toContainText('This Loan ID already exists');
  await create.getByLabel('Loan ID').fill('V2-LOAN');
  await create.getByLabel('Debt description').fill('Fictional test loan');
  await create.getByLabel('Debtor account').fill('Household');
  await create.getByLabel('Creditor account').fill('Pets etc.');
  await create.getByLabel('Opening amount').fill('10.25');
  await expect(create.getByRole('button', { name: 'Create debt' })).toBeEnabled();
  await create.getByRole('button', { name: 'Create debt' }).click();
  const drawer = page.getByRole('complementary', { name: 'Loan V2-LOAN' });
  await expect(drawer).toContainText('Household owes Pets etc. $10.25');
  await drawer.getByRole('button', { name: 'Record payment' }).click();
  const payment = page.getByRole('dialog', { name: 'Record payment' });
  await payment.getByLabel('Payment amount').fill('3.25');
  await payment.getByRole('button', { name: 'Save payment' }).click();
  await expect(drawer).toContainText('Household owes Pets etc. $7.00');
  const events = drawer.getByRole('table', { name: 'Debt events' });
  await events.getByRole('row').filter({ hasText: 'pmt' }).getByRole('button', { name: 'Correct' }).click();
  await events.getByLabel('Signed change').fill('-4.25');
  await events.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toContainText('Household owes Pets etc. $6.00');
  await drawer.getByRole('button', { name: 'Record payment' }).click();
  const adjustment = page.getByRole('dialog', { name: 'Record payment' });
  await adjustment.getByRole('checkbox', { name: 'Advanced: signed adjustment' }).check();
  const signedAdjustment = page.getByRole('dialog', { name: 'Record adjustment' });
  await signedAdjustment.getByLabel('Signed change').fill('-1.25');
  await signedAdjustment.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(drawer).toContainText('Household owes Pets etc. $4.75');
  await events
    .getByRole('row')
    .filter({ hasText: 'pmt' })
    .first()
    .getByRole('button', { name: 'Delete event' })
    .click();
  await page
    .getByRole('dialog', { name: 'Please confirm' })
    .getByRole('button', { name: 'Delete event' })
    .click();
  await expect(drawer).toContainText('Household owes Pets etc. $9.00');
  await page.getByRole('button', { name: /Undo: Delete debt event/ }).click();
  await expect(drawer).toContainText('Household owes Pets etc. $4.75');
  await drawer.getByRole('button', { name: 'Delete debt…' }).click();
  await page
    .getByRole('dialog', { name: 'Please confirm' })
    .getByRole('button', { name: 'Delete debt' })
    .click();
  await expect(page.getByRole('complementary', { name: 'Loan V2-LOAN' })).toHaveCount(0);
  await page.getByRole('button', { name: /Undo: Delete debt/ }).click();
  await expect(page.getByRole('table', { name: 'Debt detail' })).toContainText('V2-LOAN');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Debt detail' })).toContainText('V2-LOAN');
});

test('monthly journal create, validation, edit, CSV, delete and undo preserve postings', async ({
  page,
}, testInfo) => {
  await page.goto(`${BASE}monthly`);
  const journal = page.getByRole('table', { name: 'Transfer journal' });
  const entry = page.getByRole('row', { name: 'New transfer' });
  await entry.getByLabel('Date').fill('2026-09-24');
  await entry.getByLabel('Description').fill('V2 transfer');
  await entry.getByLabel('From account').fill('Household');
  await entry.getByLabel('To account').fill('Household');
  await entry.getByLabel('Amount').fill('1.25');
  await entry.getByRole('button', { name: 'Add' }).click();
  await expect(journal.getByRole('alert')).toBeVisible();
  await entry.getByLabel('To account').fill('Pets etc.');
  await entry.getByRole('button', { name: 'Add' }).click();
  let row = journal.getByRole('row').filter({ hasText: 'V2 transfer' });
  await expect(row).toContainText('$1.25');
  await row.getByRole('button', { name: 'Edit' }).click();
  const edit = journal.getByRole('row', { name: 'Edit transfer' });
  await edit.getByLabel('Amount').fill('2.25');
  await edit.getByRole('button', { name: 'Save' }).click();
  row = journal.getByRole('row').filter({ hasText: 'V2 transfer' });
  await expect(row).toContainText('$2.25');
  await page.getByRole('textbox', { name: 'Month notes' }).fill('V2 note');
  await page.getByRole('textbox', { name: 'Month notes' }).press('Tab');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Month notes' })).toHaveValue('V2 note');
  await expect(journal).toContainText('V2 transfer');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export journal CSV' }).click();
  const csv = testInfo.outputPath('v2-journal.csv');
  await (await download).saveAs(csv);
  expect(readFileSync(csv, 'utf8')).toContain('V2 transfer');
  await row.getByRole('button', { name: 'Delete entry' }).click();
  await page.getByRole('dialog', { name: 'Please confirm' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete entry' }).click();
  await page
    .getByRole('dialog', { name: 'Please confirm' })
    .getByRole('button', { name: 'Delete entry' })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: /Undo: Delete journal entry/ }).click();
  await expect(journal).toContainText('V2 transfer');
});

test('budget duplication, activation, draft deletion and navigation retain version history', async ({
  page,
}) => {
  await page.goto(`${BASE}budget`);
  await page
    .getByRole('group', { name: 'Budget sections' })
    .getByRole('button', { name: 'Tax rules' })
    .click();
  await expect(page).toHaveURL(/tab=tax/);
  await page
    .getByRole('group', { name: 'Budget sections' })
    .getByRole('button', { name: 'Budget versions' })
    .click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.getByLabel('Version label').fill('V2 budget plan');
  await page.getByLabel('Version label').press('Enter');
  await page.getByRole('button', { name: 'Activate…' }).click();
  const activate = page.getByRole('dialog', { name: 'Activate V2 budget plan' });
  await activate.getByLabel('In effect from').fill('2026-10');
  await activate.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Budget versions' })).toContainText('V2 budget plan');
  await expect(
    page
      .getByRole('table', { name: 'Budget versions' })
      .getByRole('row')
      .filter({ hasText: 'V2 budget plan' }),
  ).toContainText('Active');
  await page
    .getByRole('region', { name: 'Budget history' })
    .getByRole('button', { name: 'New empty draft' })
    .click();
  const draft = page.getByRole('dialog', { name: 'New empty budget draft' });
  await draft.getByLabel('Label').fill('V2 disposable draft');
  await draft.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('table', { name: 'Budget versions' })).toContainText('V2 disposable draft');
  await page.getByRole('button', { name: 'Delete draft' }).click();
  await page
    .getByRole('dialog', { name: 'Please confirm' })
    .getByRole('button', { name: 'Delete budget' })
    .click();
  await expect(page.getByRole('table', { name: 'Budget versions' })).not.toContainText('V2 disposable draft');
  await page.reload();
  await expect(page.getByRole('table', { name: 'Budget versions' })).toContainText('V2 budget plan');
  await page.goto(`${BASE}dashboard`);
  await expect(
    page.getByRole('group', { name: 'Summary' }).getByRole('button', { name: /^Expected cash/ }),
  ).toContainText('$4,690.96');
});

test('all eight pages have no viewport overflow at review widths', async ({ page }, testInfo) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 812 : 900 });
    for (const route of routes) {
      await page.goto(`${BASE}${route}`);
      const main = page.locator('main');
      const sizes = await main.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(sizes.scroll, `${route} at ${width}px`).toBeLessThanOrEqual(sizes.client);
      await page.screenshot({ path: testInfo.outputPath(`v2-${route}-${width}.png`), fullPage: true });
      await main.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.screenshot({ path: testInfo.outputPath(`v2-${route}-${width}-bottom.png`) });
    }
  }
});

test('key dialogs and debt drawer fit and render at every review width', async ({ page }, testInfo) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 812 : 900 });
    await page.goto(`${BASE}monthly`);
    await page.getByRole('button', { name: 'Advanced entry' }).click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-advanced-entry-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New month' }).click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-new-month-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByLabel('Household budget allocation').fill('3200');
    await page.getByLabel('Household budget allocation').press('Enter');
    await page
      .getByRole('note', { name: 'Budget overrides' })
      .getByRole('button', { name: 'Review' })
      .click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-refresh-budget-${width}.png`) });
    await page.keyboard.press('Escape');

    await page.goto(`${BASE}debts`);
    await page.getByRole('button', { name: 'New debt' }).click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-new-debt-${width}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-payment-${width}.png`) });
    await page.keyboard.press('Escape');
    await page
      .getByRole('table', { name: 'Debt detail' })
      .getByRole('button', { name: 'H-01', exact: true })
      .click();
    await fitsViewport(page, 'aside.drawer');
    await page.screenshot({ path: testInfo.outputPath(`v2-loan-drawer-${width}.png`) });
    await page.locator('aside.drawer > .body').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: testInfo.outputPath(`v2-loan-drawer-${width}-bottom.png`) });

    await page.goto(`${BASE}accounts`);
    await expect(page.getByRole('table', { name: 'Accounts' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`v2-accounts-${width}.png`) });

    await page.goto(`${BASE}budget`);
    await page
      .getByRole('region', { name: 'Budget history' })
      .getByRole('button', { name: 'New empty draft' })
      .click();
    await fitsViewport(page, 'dialog[open]');
    await page.screenshot({ path: testInfo.outputPath(`v2-new-budget-${width}.png`) });
  }
});
