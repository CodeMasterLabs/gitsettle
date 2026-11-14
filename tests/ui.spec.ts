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
  await page.evaluate(() => window.scrollTo(0, 0));
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
  await expect(page.getByRole('heading', { level: 1, name: 'Work queue' })).toBeVisible();
  await expect(page.getByLabel('Loading content', { exact: true })).toHaveCount(0);
});

test('quick bounty views change the working set without losing the table controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.bounty-row')).toHaveCount(8);
  await page.getByRole('button', { name: 'Open to claim', exact: false }).click();
  await expect(page.locator('.bounty-row')).toHaveCount(4);
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Open');
  await page.getByRole('button', { name: 'Translations', exact: true }).click();
  await expect(page.locator('.bounty-row')).toHaveCount(3);
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('Translation');
  await page.getByRole('button', { name: 'All work', exact: false }).click();
  await expect(page.locator('.bounty-row')).toHaveCount(8);
});

test('reward category tiles exclude expired work and translation discovery resets prior filters', async ({ page }) => {
  await page.goto('/');
  const bugs = page.getByRole('button', { name: /^Browse open bug fixes/i });
  await expect(bugs).toContainText('12.00');
  await bugs.click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('Bug');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('Open');
  await expect(page.locator('.bounty-row')).toHaveCount(1);
  await expect(page.locator('.bounty-title')).toHaveText('Prevent stale balances after a confirmed payout');
  await page.getByRole('button', { name: /^Browse open security audits/i }).click();
  await expect(page.getByRole('heading', { name: 'No bounties match these filters.' })).toBeVisible();
  await page.getByLabel('Find an issue', { exact: true }).fill('unmatched search');
  await page.getByRole('button', { name: 'Explore translations', exact: true }).click();
  await expect(page.getByLabel('Find an issue', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('Translation');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('all');
  await expect(page.locator('.bounty-row')).toHaveCount(3);
});

test('global bounty search carries the query into the work queue', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'The mobile queue has its own visible search input.');
  await page.goto('/leaderboard');
  await page.getByLabel('Search all bounties', { exact: true }).fill('Bengali');
  await page.getByRole('button', { name: 'Search bounties', exact: true }).click();
  await expect(page).toHaveURL(/\/\?q=Bengali$/);
  await expect(page.getByLabel('Find an issue', { exact: true })).toHaveValue('Bengali');
  await expect(page.locator('.bounty-row')).toHaveCount(1);
  await expect(page.locator('.bounty-title')).toHaveText('Bring the contributor guide to Bengali');
});

test('settled bounties do not show active claiming or payout-routing instructions', async ({ page }) => {
  await page.route('**/api/bounties/6', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...data, automation: { agentGuardEnabled: true, maxAutomaticPayoutYocto: '5000000000000000000000000' } }) });
  });
  await page.goto('/bounties/6');
  await expect(page.getByText('Reward settled', { exact: true })).toBeVisible();
  await expect(page.locator('.wallet-notice')).toHaveCount(0);
  await expect(page.getByText('Automated payout limit:', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Claim this bounty', exact: true })).toHaveCount(0);
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

test('both appearances keep short-screen navigation reachable and narrow footer text readable', async ({ page }) => {
  async function changeAppearance(theme: 'light' | 'dark') {
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: theme === 'light' ? 'Light appearance' : 'Dark appearance', exact: true }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
  }

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.bounty-row')).toHaveCount(8);
    for (const theme of ['light', 'dark'] as const) {
      await changeAppearance(theme);
      const sidebar = page.locator('aside.sidebar');
      const bounds = (await sidebar.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      const links = await sidebar.getByRole('link').evaluateAll(elements => elements.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      }));
      for (let first = 0; first < links.length; first++) for (let next = first + 1; next < links.length; next++) {
        const a = links[first], b = links[next];
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
          && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
        expect(overlap, `Sidebar links overlap in ${theme} at ${viewport.width}×${viewport.height}`).toBe(false);
      }
      await sidebar.getByRole('link', { name: 'GitSettle home', exact: true }).focus();
      for (const name of ['View source', 'Command line']) {
        const link = sidebar.getByRole('link', { name, exact: true });
        for (let tabs = 0; tabs < 12 && !await link.evaluate(element => element === document.activeElement); tabs++) await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        const target = (await link.boundingBox())!;
        expect(target.y).toBeGreaterThanOrEqual(bounds.y);
        expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
        expect(await page.evaluate(() => window.scrollY), 'Keyboard navigation should scroll the sidebar without moving the page').toBe(0);
      }
      await checkPageWidth(page);
    }
  }

  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/');
  await expect(page.locator('.bounty-row')).toHaveCount(8);
  for (const theme of ['light', 'dark'] as const) {
    await changeAppearance(theme);
    const footer = page.getByRole('contentinfo');
    const name = (await footer.getByText('GitSettle', { exact: true }).boundingBox())!;
    const description = (await footer.getByText('Contribution infrastructure for open source.', { exact: true }).boundingBox())!;
    expect(description.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    for (const box of [name, description]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(321);
    }
    const count = page.getByText('8 bounties in the queue', { exact: true });
    const countBox = (await count.boundingBox())!;
    const sortBox = (await page.getByLabel('Sort bounties', { exact: true }).boundingBox())!;
    expect(countBox.height).toBeLessThanOrEqual(await count.evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight) * 2));
    expect(sortBox.y).toBeGreaterThanOrEqual(countBox.y + countBox.height - 1);
    await checkPageWidth(page);
  }
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
  await page.route('**/api/transactions/confirm', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'failed', verifiedAction: true, message: 'Fixture: transfer failed; reward remains in escrow.', txHash: simulatedHash }) }));
  await page.goto('/');
  await expect(page.getByText('Transaction not completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('reward remains in escrow');
  await expect(page.getByText('Transaction confirmed', { exact: true })).toHaveCount(0);
  await capture(page, info, 'transaction-failed-fixture');
  await page.getByRole('button', { name: 'Dismiss transaction message' }).click();
  await expect(page.getByText('Transaction not completed', { exact: true })).toHaveCount(0);
});

/** Layout-only fixture: reproduces the connected header markup without loading a wallet or signing. */
test('narrow connected-wallet header keeps controls separate and touch targets usable', async ({ page }, info) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');
    await expect(page.locator('.bounty-row')).toHaveCount(8);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const account = 'contributor.gitsettle-ac1b0f23f4.testnet';
      document.querySelector('.topbar')!.classList.add('has-account');
      document.querySelector('.wallet-controls')!.innerHTML = `<a class="account-link" href="/contributors/${account}" title="${account}"><span class="account-dot"></span>${account.slice(0, 16)}…${account.slice(-9)}</a><button class="button button-quiet compact">Disconnect</button>`;
    });
    const boxes = await page.locator('.breadcrumbs, .topbar .theme-toggle, .account-link, .wallet-controls .compact').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    for (let index = 1; index < boxes.length; index++) expect(boxes[index].height).toBeGreaterThanOrEqual(44);
    for (let first = 0; first < boxes.length; first++) for (let next = first + 1; next < boxes.length; next++) {
      const a = boxes[first], b = boxes[next];
      const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
      expect(overlap, `Header controls overlap at ${width}px`).toBe(false);
    }
    await expect(page.locator('.sidebar-network')).toBeVisible();
    const inputSizes = await page.locator('main input, main select, main textarea').evaluateAll(elements => elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
    expect(inputSizes.every(size => size >= 16)).toBe(true);
    await checkPageWidth(page);
    if (width === 375) await capture(page, info, 'connected-wallet-layout-fixture');
  }
});
