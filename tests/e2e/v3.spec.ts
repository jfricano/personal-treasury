import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.context().addInitScript(() => localStorage.setItem('pt.demo.tourSeen', '1'));
  await page.goto('/#/analysis');
  await expect(page.getByRole('heading', { name: 'Budget Analysis', exact: true })).toBeVisible();
});
test('V3-AT14 sample review → pairing and classification → clear → export → undo cannot restore transactions', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try a sample review' }).click();
  await expect(page.getByText('7 posted transactions')).toBeVisible();
  await page
    .getByLabel('Pair Card payment', { exact: true })
    .selectOption({ label: '2026-08-10 · Payment received' });
  const classify = page.getByRole('button', { name: 'Classify', exact: true });
  for (const index of [0, 1, 4, 5, 6]) {
    await classify.nth(index).click();
    const dialog = page.getByRole('dialog', { name: 'Classify transaction' });
    await dialog
      .getByRole('combobox', { name: 'Classification', exact: true })
      .selectOption(index === 1 ? 'income' : 'unbudgeted');
    await dialog.getByRole('button', { name: 'Accept classification' }).click();
  }
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ready to clear' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear month', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear month' }).click();
  await expect(page.getByText('Transaction details have been deleted.')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report' }).click();
  expect((await downloaded).suggestedFilename()).toBe('Spending report 2026-08.xlsx');
  const raw = await page.evaluate(() => sessionStorage.getItem('pt-v3-reviews:demo'));
  expect(raw).not.toContain('Harbor Market');
  expect(raw).not.toContain('Monthly pay');
  await page.getByRole('button', { name: /Undo: Clear spending report/ }).click();
  await expect(page.getByRole('heading', { name: 'No cleared reports yet' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pt-v3-reviews:demo'))).not.toContain(
    'Harbor Market',
  );
});
test('V3-AT1 grouped phone menu, escape focus, one heading and no overflow at four sizes', async ({
  page,
}) => {
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/analysis');
    await expect(page.locator('main h1')).toHaveCount(1);
    if (width === 390) {
      const menu = page.getByRole('button', { name: /Menu · Budget Analysis/ });
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await menu.click();
      await expect(page.getByRole('link', { name: 'Connected Accounts', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await menu.click();
      await page.getByRole('link', { name: 'Connected Accounts', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Connected Accounts', exact: true })).toBeFocused();
    }
    expect(await page.locator('main').evaluate((m) => m.scrollWidth <= m.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/v3-${width}.png`, fullPage: true });
  }
});

test('demo reset discards ephemeral review details and database undo does not restore them', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Try a sample review' }).click();
  await expect(page.getByText('7 posted transactions')).toBeVisible();
  await page.getByRole('button', { name: 'Reset sample data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset to sample data' }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('pt-v3-reviews:demo'))).not.toContain(
    'Harbor Market',
  );
  await page.getByRole('button', { name: /Undo: Reset to sample data/ }).click();
  expect(await page.evaluate(() => sessionStorage.getItem('pt-v3-reviews:demo'))).not.toContain(
    'Harbor Market',
  );
});
