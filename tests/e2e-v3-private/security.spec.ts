import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('V3-AT12 password + recovery code, passkey enrollment, encrypted storage and reload/unlock', async ({
  page,
}) => {
  const access = JSON.parse(readFileSync('test-results/v3-access.json', 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByLabel('User ID', { exact: true }).fill(access.userId);
  await page.getByLabel('Password', { exact: true }).fill(access.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('combobox', { name: 'Second factor' }).selectOption('recovery');
  await page.getByLabel('Recovery code', { exact: true }).fill(access.recoveryCodes[1]);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
  }));
  expect(storage.local).not.toContain(access.password);
  expect(storage.session).not.toContain(access.password);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unlock your treasury' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).not.toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(access.password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.getByRole('button', { name: 'Register a passkey' }).click();
  await expect(page.getByText('Passkey registered', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your treasury' })).toBeVisible();
  expect(errors).toEqual([]);
});
