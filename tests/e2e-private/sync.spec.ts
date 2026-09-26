import { expect, test, type Page } from '@playwright/test';

const token = 'private-e2e-token-0123456789abcdef0123456789abcdef';
const passphrase = 'a long test-only sync passphrase';

async function connect(page: Page, first: boolean) {
  await page.goto('/');
  await page.getByLabel('Access token').fill(token);
  await page.getByLabel('Sync passphrase').fill(passphrase);
  if (first) await page.getByLabel('Repeat passphrase (first cloud upload)').fill(passphrase);
  await page.getByRole('button', { name: 'Connect to cloud' }).click();
  await expect(page.getByRole('heading', { name: 'Personal Treasury', exact: true })).toBeVisible();
}

async function addAccount(page: Page, name: string) {
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByLabel('New account name').fill(name);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(
    page.getByRole('table', { name: 'Accounts' }).getByRole('textbox', { name: `${name} name` }),
  ).toHaveValue(name);
}

async function expectVersion(page: Page, revision: number) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('status').filter({ hasText: `cloud version ${revision}` })).toBeVisible();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
}

test('phone and desktop share snapshots and keep a version history', async ({ browser, page }) => {
  await connect(page, true);
  await addAccount(page, 'Desktop bucket');
  await expectVersion(page, 2);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  await connect(phonePage, false);
  await phonePage.getByRole('link', { name: 'Accounts' }).click();
  await expect(
    phonePage.getByRole('table', { name: 'Accounts' }).getByRole('textbox', { name: 'Desktop bucket name' }),
  ).toHaveValue('Desktop bucket');
  await addAccount(phonePage, 'Phone bucket');
  await expectVersion(phonePage, 3);

  await page.getByRole('button', { name: 'Sync now' }).click();
  await expectVersion(page, 3);
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(
    page.getByRole('table', { name: 'Accounts' }).getByRole('textbox', { name: 'Phone bucket name' }),
  ).toHaveValue('Phone bucket');

  await page.context().setOffline(true);
  await addAccount(page, 'Offline bucket');
  await addAccount(phonePage, 'Other bucket');
  await expectVersion(phonePage, 4);
  await page.context().setOffline(false);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Use cloud copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Use cloud copy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use cloud copy' }).click();
  await expectVersion(page, 4);
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(
    page.getByRole('table', { name: 'Accounts' }).getByRole('textbox', { name: 'Other bucket name' }),
  ).toHaveValue('Other bucket');
  await expect(
    page.getByRole('table', { name: 'Accounts' }).getByRole('textbox', { name: 'Offline bucket name' }),
  ).toHaveCount(0);
  await phone.close();
});
