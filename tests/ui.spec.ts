import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const screens = [
  { path: '/', name: 'work-queue' },
  { path: '/bounties/0', name: 'bounty-detail' },
  { path: '/bounties/new', name: 'post-bounty' },
  { path: '/leaderboard', name: 'leaderboard' },
  { path: '/contributors/maya.demo.testnet', name: 'contributor-profile' },
  { path: '/dashboard', name: 'maintainer-dashboard' },
];

/** These captures are review artifacts, not a claim that layout correctness is automated. */
async function capture(page: Page, info: TestInfo, name: string) {
  const directory = resolve('docs/screenshots', info.project.name);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true, animations: 'disabled' });
}

async function checkAccessibility(page: Page, info: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical');
  if (violations.length) await info.attach('accessibility-violations', {
    body: JSON.stringify(violations, null, 2), contentType: 'application/json',
  });
  expect(violations, 'Axe found serious or critical WCAG A/AA violations').toEqual([]);
}

async function checkPageWidth(page: Page) {
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content, 'The page should not scroll horizontally').toBeLessThanOrEqual(width.viewport + 1);
}

test.beforeAll(async ({ request }) => {
  const config = await (await request.get('/api/config')).json();
  expect(config.mode, 'Browser QA must run against DEMO_MODE=true; no wallet is connected').toBe('demo');
});

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript((theme) => {
    if (!localStorage.getItem('gitsettle.theme')) localStorage.setItem('gitsettle.theme', theme);
  }, info.project.name === 'dark' ? 'dark' : 'light');
});

for (const screen of screens) {
  test(`${screen.name}: responsive layout, accessibility and capture`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(screen.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Demo data.', { exact: true })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await checkPageWidth(page);
    await checkAccessibility(page, info);
    await capture(page, info, screen.name);
    expect(errors, 'Page must not throw browser runtime errors').toEqual([]);
  });
}

test('queue filters combine type, exact reward and status, then recover from empty results', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.bounty-row')).toHaveCount(8);
  await page.getByLabel('Work type', { exact: true }).selectOption('Translation');
  await expect(page.locator('.bounty-row')).toHaveCount(3);
  await expect(page.locator('.locale-badge')).toHaveText(['ja', 'bn', 'es']);
  await page.getByLabel('Minimum reward in NEAR').fill('19');
  await expect(page.locator('.bounty-row')).toHaveCount(1);
  await expect(page.locator('.bounty-title')).toHaveText('Bring the contributor guide to Bengali');
  await page.getByLabel('Status', { exact: true }).selectOption('Claimed');
  await expect(page.getByRole('heading', { name: 'No bounties match these filters.' })).toBeVisible();
  await capture(page, info, 'empty-filter-results');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.bounty-row')).toHaveCount(8);
  await page.getByLabel('Status', { exact: true }).selectOption('Expired');
  await expect(page.locator('.bounty-row')).toHaveCount(1);
  await expect(page.locator('.status-expired')).toHaveText('Expired');
});

test('loading skeleton gives way to the work queue', async ({ page }, info) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/bounties', async (route) => { await wait; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Loading content', { exact: true })).toBeVisible();
  await capture(page, info, 'loading-queue');
  release();
  await expect(page.getByRole('heading', { level: 1, name: 'The work queue' })).toBeVisible();
});

test('an API error is readable and retry reloads the queue', async ({ page }, info) => {
  await page.route('**/api/bounties', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The queue is temporarily unavailable. Try again.' }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'This view could not be loaded.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('The queue is temporarily unavailable.');
  await checkAccessibility(page, info);
  await capture(page, info, 'queue-error');
  await page.unroute('**/api/bounties');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.bounty-row')).toHaveCount(8);
});

test('translation draft validates inputs and reviews the exact deposit', async ({ page }, info) => {
  await page.goto('/bounties/new');
  await page.getByRole('button', { name: 'Review bounty' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Check the highlighted fields');
  await expect(page.getByLabel('Issue URL', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Issue URL', { exact: true }).fill('https://github.com/CodeMasterLabs/gitsettle/issues/1');
  await page.getByLabel('Work type', { exact: true }).selectOption('Translation');
  await page.getByLabel('Target locale', { exact: true }).selectOption('es');
  await page.getByLabel('Reward (NEAR)', { exact: true }).fill('2.123456789012345678901234');
  await page.getByRole('button', { name: 'Review bounty' }).click();
  await expect(page.getByRole('heading', { name: 'Review the escrow' })).toBeVisible();
  await expect(page.locator('.review-total dd')).toHaveText('2.173456789012345678901234 NEAR');
  await expect(page.locator('.review-list')).toContainText('0.05 NEAR');
  await expect(page.getByRole('button', { name: 'Connect to fund' })).toBeDisabled();
  await expect(page.getByText('Funding is disabled while this instance is showing demo data.')).toBeVisible();
  await checkPageWidth(page);
  await checkAccessibility(page, info);
  await capture(page, info, 'review-bounty');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByLabel('Reward (NEAR)', { exact: true })).toHaveValue('2.123456789012345678901234');
  await page.reload();
  await expect(page.getByLabel('Reward (NEAR)', { exact: true })).toHaveValue('2.123456789012345678901234');
});

test('expired bounty explains the deadline and disables new claims', async ({ page }, info) => {
  await page.goto('/bounties/7');
  await expect(page.getByText('Deadline passed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim this bounty' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet to claim' })).toHaveCount(0);
  await capture(page, info, 'expired-bounty');
});

test('theme preference survives navigation and keyboard focus is visible', async ({ page }, info) => {
  await page.goto('/');
  const expectedTheme = info.project.name === 'dark' ? 'dark' : 'light';
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('button', { name: expectedTheme === 'dark' ? 'Light appearance' : 'Dark appearance' }).click();
  const changedTheme = expectedTheme === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', changedTheme);
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.theme'))).toBe(changedTheme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', changedTheme);
});

/** Response fixtures exercise presentation/recovery only. No signing or payout is simulated as evidence. */
const simulatedConfig = { mode: 'testnet', contractId: 'ui-fixture.testnet', rpcUrl: 'https://rpc.testnet.near.org', network: 'testnet' };
const simulatedHash = 'A'.repeat(44);

async function installTransactionFixture(page: Page) {
  await page.route('**/api/config', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(simulatedConfig) }));
  await page.addInitScript(({ hash }) => {
    localStorage.setItem('gitsettle.pending.v1', JSON.stringify({
      method: 'claim_bounty', accountId: 'maya.demo.testnet', bountyId: 0,
      expectedArgs: { id: 0 }, createdAt: Date.now(), txHash: hash,
    }));
  }, { hash: simulatedHash });
}

test('wallet-not-connected state is explicit in testnet configuration', async ({ page }, info) => {
  await page.route('**/api/config', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(simulatedConfig) }));
  await page.goto('/');
  await expect(page.getByText('Connect your NEAR wallet to claim work or fund a bounty.')).toBeVisible();
  await expect(page.locator('.wallet-notice').getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
  await capture(page, info, 'wallet-not-connected');
});

test('pending transaction presentation advances only after confirmed API evidence', async ({ page }, info) => {
  await installTransactionFixture(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/transactions/confirm', async (route) => {
    await wait;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'confirmed', message: 'Fixture: bounty claim confirmed.', txHash: simulatedHash, bountyId: 0 }) });
  });
  await page.goto('/');
  await expect(page.getByText('Transaction pending', { exact: true })).toBeVisible();
  await capture(page, info, 'transaction-pending-fixture');
  release();
  await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
  await capture(page, info, 'transaction-confirmed-fixture');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('failed transaction presentation shows recovery without announcing payment', async ({ page }, info) => {
  await installTransactionFixture(page);
  await page.route('**/api/transactions/confirm', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'failed', message: 'Fixture: transfer failed; reward remains in escrow.', txHash: simulatedHash }) }));
  await page.goto('/');
  await expect(page.getByText('Transaction not completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('reward remains in escrow');
  await expect(page.getByText('Transaction confirmed', { exact: true })).toHaveCount(0);
  await capture(page, info, 'transaction-failed-fixture');
  await page.getByRole('button', { name: 'Dismiss transaction message' }).click();
  await expect(page.getByText('Transaction not completed', { exact: true })).toHaveCount(0);
});
