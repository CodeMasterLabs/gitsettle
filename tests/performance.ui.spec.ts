import { expect, test, type Page } from '@playwright/test';

const config = { mode: 'testnet', network: 'testnet', contractId: 'ui-fixture.testnet', rpcUrl: 'https://test.rpc.fastnear.com' };
const pending = { method: 'claim_bounty', accountId: 'maya.demo.testnet', bountyId: 0, expectedArgs: { id: 0 }, createdAt: 1, txHash: 'A'.repeat(44) };

async function configure(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }));
}

/** This opens only the selector modal; no wallet, key, or transaction is used. */
test('ordinary browsing defers wallet code until Connect is requested', async ({ page }) => {
  await configure(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name)).length);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await expect(page.getByText('MyNearWallet', { exact: true }).first()).toBeVisible();
  const after = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name)).length);
  expect(after).toBeGreaterThan(before);
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('a failed optional wallet download cannot erase a pending action', async ({ page }) => {
  await configure(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const browsingScripts = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name)).map(entry => entry.name));
  let checked = false;
  await page.route('**/api/transactions/confirm', route => {
    checked = true;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'pending', message: 'Fixture: awaiting finality.' }) });
  });
  await page.route('**/_next/static/**/*.js', route => browsingScripts.includes(route.request().url()) ? route.continue() : route.abort());
  await page.evaluate(value => localStorage.setItem('gitsettle.pending.v1', JSON.stringify(value)), pending);
  await page.reload();
  await expect(page.getByText('Transaction pending', { exact: true })).toBeVisible();
  await expect.poll(() => checked).toBe(true);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1')))!)).toMatchObject(pending);
});

test('a mismatched return hash preserves the original action for recovery', async ({ page }) => {
  await configure(page);
  await page.addInitScript(value => localStorage.setItem('gitsettle.pending.v1', JSON.stringify(value)), pending);
  await page.route('**/api/transactions/confirm', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'failed', verifiedAction: false, message: 'Fixture: this hash belongs to another action.' }) }));
  await page.goto('/');
  await expect(page.getByText('Transaction pending', { exact: true })).toBeVisible();
  await expect(page.getByText(/this hash belongs to another action/)).toBeVisible();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1')))!);
  expect(saved).toMatchObject({ method: pending.method, accountId: pending.accountId, bountyId: 0, expectedArgs: { id: 0 } });
  expect(saved.txHash).toBeUndefined();
  await expect(page.getByText('Transaction confirmed', { exact: true })).toHaveCount(0);
});
