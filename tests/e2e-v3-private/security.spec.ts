import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('V3-AT12 password + recovery code, passkey enrollment, encrypted storage and reload/unlock', async ({
  page,
}) => {
  const access = JSON.parse(readFileSync('test-results/v3-access.json', 'utf8'));
  const errors: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { policyViolations: string[] }).policyViolations = [];
    window.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { policyViolations: string[] }).policyViolations.push(
        JSON.stringify({
          directive: e.violatedDirective,
          sample: e.sample,
          source: e.sourceFile,
          line: e.lineNumber,
          disposition: e.disposition,
        }),
      );
    });
  });
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
  function code(secret: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0,
      value = 0;
    const bytes = [];
    for (const c of secret) {
      value = (value << 5) | alphabet.indexOf(c);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
    const offset = mac[19] & 15;
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
  }
  // Recovery-code sign-in alone must not grant fresh proof for sensitive changes.
  await page.getByRole('button', { name: 'Register a passkey' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'step up required' })).toBeVisible();
  // Initial sign-in and reload consume the five-request authentication burst.
  await new Promise((resolve) => setTimeout(resolve, 6500));
  await page.getByLabel('Authenticator code for sensitive changes').fill(code(access.totpSecret));
  await page.getByRole('button', { name: 'Register a passkey' }).click();
  await expect(page.getByText('Passkey registered', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh access list' }).click();
  await expect(page.getByRole('button', { name: 'Remove passkey 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Generate new recovery codes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('region', { name: 'New recovery codes' })).toBeVisible();
  const newCodes = (
    await page.getByRole('region', { name: 'New recovery codes' }).locator('pre').innerText()
  ).split('\n');
  expect(newCodes).toHaveLength(10);
  expect(newCodes).not.toContain(access.recoveryCodes[1]);
  await page.getByRole('button', { name: 'I saved these codes' }).click();
  await expect(page.getByRole('region', { name: 'New recovery codes' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Remove passkey 1', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('No passkeys registered yet.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Budget Analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.getByLabel('Review note', { exact: true }).fill('FICTIONAL REVIEW BASE');
  await page.getByLabel('Review note', { exact: true }).blur();
  await page.getByRole('button', { name: 'Sync reviews now' }).click();
  await expect(page.getByText('Reviews up to date', { exact: true })).toBeVisible();
  const otherContext = await page
    .context()
    .browser()!
    .newContext({ storageState: { cookies: await page.context().cookies(), origins: [] } });
  try {
    const other = await otherContext.newPage();
    await other.goto('http://localhost:8788/#/analysis');
    // Refill the configured authentication bucket before the second browser unlocks.
    await new Promise((resolve) => setTimeout(resolve, 13000));
    await other.getByLabel('Password', { exact: true }).fill(access.password);
    await other.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Budget Analysis', exact: true })).toBeVisible();
    await other.getByRole('button', { name: / · open$/ }).click();
    await other.getByRole('tab', { name: 'Summary', exact: true }).click();
    await expect(other.getByLabel('Review note', { exact: true })).toHaveValue('FICTIONAL REVIEW BASE');
    await page.getByLabel('Review note', { exact: true }).fill('FICTIONAL COPY ONE');
    await page.getByLabel('Review note', { exact: true }).blur();
    await other.getByLabel('Review note', { exact: true }).fill('FICTIONAL COPY TWO');
    await other.getByLabel('Review note', { exact: true }).blur();
    await page.getByRole('button', { name: 'Sync reviews now' }).click();
    await expect(page.getByText('Reviews up to date', { exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Sync reviews now' }).click();
    await expect(other.getByRole('heading', { name: /two review copies/ })).toBeVisible();
    await other.getByRole('button', { name: 'Keep both copies' }).click();
    await expect(other.getByText('Reviews up to date', { exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: / · open$/ })).toHaveCount(2);
    await expect(other.getByLabel('Review note', { exact: true })).toHaveValue('FICTIONAL COPY ONE');
  } finally {
    await otherContext.close();
  }
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock your treasury' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { policyViolations: string[] }).policyViolations),
  ).toEqual([]);
});
