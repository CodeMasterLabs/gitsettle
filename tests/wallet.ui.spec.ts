import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

/** These tests exercise connector UI with an injected wallet API fixture.
 * No real wallet, private key, signature, transaction, or payout is used. */
const config = { mode: 'testnet', network: 'testnet', contractId: 'ui-fixture.testnet', rpcUrl: 'https://test.rpc.fastnear.com' };
const accountId = 'maya.demo.testnet';

async function configure(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }));
  await page.route('**/api/auth/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null }) }));
}

/** Implements only Nightly's documented injection surface. Signing fails closed. */
async function injectNightly(page: Page, reject = false) {
  await page.addInitScript(({ accountId, reject }) => {
    type Account = { accountId: string; publicKey: { toString(): string } };
    let onAccountChange: ((account?: Account) => void) | undefined;
    let shouldReject = reject;
    let lastMessage: Record<string, unknown> | null = null;
    let deferMessage = false;
    let completeMessage: ((result: { accountId: string; publicKey: string; signature: string }) => void) | undefined;
    const publicKey = { toString: () => 'ed25519:11111111111111111111111111111111' };
    const api = {
      account: { accountId: '', publicKey }, isConnected: false,
      async connect(callback?: (account?: Account) => void) {
        if (shouldReject) throw new Error('User rejected the connection request');
        onAccountChange = callback;
        api.account = { accountId, publicKey };
        api.isConnected = true;
        return api.account;
      },
      async disconnect() { api.account = { accountId: '', publicKey }; api.isConnected = false; },
      async signMessage(params: { nonce: Uint8Array; [key: string]: unknown }) {
        lastMessage = { ...params, nonce: Array.from(params.nonce) };
        if (deferMessage) return new Promise<{ accountId: string; publicKey: string; signature: string }>(resolve => { completeMessage = resolve; });
        throw new Error('Fixture does not sign messages');
      },
      async signTransaction() { throw new Error('Fixture does not sign transactions'); },
      async signAllTransactions() { throw new Error('Fixture does not sign transactions'); },
    };
    Object.assign(window, {
      nightly: { near: api, invalidate() {} },
      nightlyFixture: {
        allowConnection() { shouldReject = false; },
        switchAccount(next: string) { api.account = { accountId: next, publicKey }; onAccountChange?.(api.account); },
        messageRequest() { return lastMessage; },
        deferMessage() { deferMessage = true; },
        completeMessage() { completeMessage?.({ accountId, publicKey: 'ed25519:11111111111111111111111111111111', signature: 'fixture-not-a-signature' }); },
      },
    });
  }, { accountId, reject });
}

async function openPicker(page: Page) {
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true }).first();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}

async function captureModal(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const directory = resolve('docs/screenshots', info.project.name);
  await mkdir(directory, { recursive: true });
  // A top-layer dialog/backdrop covers the viewport, not the full scrollable
  // document. Capture its actual on-screen composition instead of a long page.
  const modalOpen = await page.locator('dialog[open]').count() > 0;
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: !modalOpen, animations: 'disabled' });
}

test.beforeAll(async ({ request }) => {
  expect((await (await request.get('/api/config')).json()).mode, 'Wallet QA requires the demo backend').toBe('demo');
});

test.beforeEach(async ({ page }, info) => {
  await configure(page);
  await page.addInitScript(theme => localStorage.setItem('gitsettle.theme', theme), info.project.name === 'dark' ? 'dark' : 'light');
});

test('wallet picker offers multiple providers with accessible responsive layout', async ({ page }, info) => {
  await page.goto('/');
  const { dialog } = await openPicker(page);
  for (const name of ['MyNearWallet', 'Meteor Wallet', 'Intear Wallet', 'Nightly']) {
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(dialog).toContainText('Testnet');
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''));
  if (serious.length) await info.attach('wallet-accessibility', { body: JSON.stringify(serious, null, 2), contentType: 'application/json' });
  expect(serious).toEqual([]);
  await captureModal(page, info, 'wallet-provider-picker');
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('wallet picker traps keyboard focus and Escape restores the opener', async ({ page }) => {
  await page.goto('/');
  const { dialog, trigger } = await openPicker(page);
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('MyNearWallet login requests identity without creating a browser signing key', async ({ page }) => {
  await page.addInitScript(() => {
    const attempts: string[] = [];
    Object.assign(window, { walletPopupAttempts: attempts });
    // Reject at the browser boundary: the real adapter still builds its URL,
    // but no external window, account, signature, or network request is opened.
    window.open = url => { attempts.push(String(url)); return null; };
  });
  await page.goto('/');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /^Connect with MyNearWallet/ }).click();
  await expect(dialog.getByRole('alert')).toContainText(/popup.*blocked/i);
  const attempts = await page.evaluate(() => (window as unknown as { walletPopupAttempts: string[] }).walletPopupAttempts);
  expect(attempts).toHaveLength(1);
  const loginUrl = new URL(attempts[0]);
  expect(loginUrl.origin).toBe('https://testnet.mynearwallet.com');
  expect(loginUrl.searchParams.has('contract_id')).toBe(false);
  expect(loginUrl.searchParams.has('public_key')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('functionCallKey'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('an injected wallet connection rejection stays recoverable without a pending escrow action', async ({ page }, info) => {
  await injectNightly(page, true);
  await page.goto('/');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /Nightly/ }).click();
  await expect(dialog.getByRole('alert')).toContainText(/reject|cancel/i);
  await expect(dialog.getByRole('button', { name: /Nightly/ })).toBeEnabled();
  await captureModal(page, info, 'wallet-connection-rejected-fixture');
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
  await page.evaluate(() => (window as unknown as { nightlyFixture: { allowConnection(): void } }).nightlyFixture.allowConnection());
  await dialog.getByRole('button', { name: /Nightly/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.wallet-controls')).toContainText('maya');
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('injected wallet account changes refresh identity and disconnect clears the support session', async ({ page }, info) => {
  await injectNightly(page);
  let sessionDeletes = 0;
  await page.route('**/api/auth/session', route => {
    if (route.request().method() === 'DELETE') sessionDeletes += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      session: sessionDeletes ? null : { accountId, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), isAdmin: false },
    }) });
  });
  await page.goto('/');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /Nightly/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.wallet-controls')).toContainText('maya');
  const manage = page.getByRole('button', { name: `Manage wallet ${accountId}`, exact: true });
  await manage.click();
  const accountDialog = page.getByRole('dialog', { name: 'Your wallet', exact: true });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toContainText(accountId);
  await expect(accountDialog).toContainText('Nightly');
  await captureModal(page, info, 'wallet-account-modal-fixture');
  await accountDialog.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect a wallet', exact: true })).toBeVisible();
  expect(sessionDeletes, 'Browsing wallet choices must not silently sign out the current account').toBe(0);
  await page.keyboard.press('Escape');
  await expect(accountDialog).not.toBeVisible();
  await expect(manage).toBeFocused();
  await page.evaluate(() => (window as unknown as { nightlyFixture: { switchAccount(next: string): void } }).nightlyFixture.switchAccount('translator.demo.testnet'));
  await expect(page.locator('.wallet-controls')).toContainText('translator');
  await expect.poll(() => sessionDeletes, 'Switching account must discard the old private support session').toBeGreaterThan(0);
  const deletesAfterSwitch = sessionDeletes;
  await captureModal(page, info, 'wallet-connected-injected-fixture');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  await expect.poll(() => sessionDeletes, 'Disconnect must also end the private support session').toBeGreaterThan(deletesAfterSwitch);
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('Nightly support sign-in preserves the complete NEP-413 challenge without starting an escrow action', async ({ page }) => {
  await injectNightly(page);
  const challenge = {
    challengeId: 'ui-nep413-challenge', state: 'ui-nep413-challenge',
    message: 'Fixture support sign-in challenge', recipient: 'gitsettle-ui.test',
    nonce: Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64'),
    callbackUrl: 'http://127.0.0.1:3000/support', expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
  let sessionWrites = 0;
  await page.route('**/api/auth/challenge', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ challenge }) }));
  await page.route('**/api/auth/session', route => {
    if (route.request().method() === 'POST') sessionWrites += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null }) });
  });
  await page.goto('/support');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /Nightly/ }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Sign in to support', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Fixture does not sign messages');
  const request = await page.evaluate(() => (window as unknown as { nightlyFixture: { messageRequest(): Record<string, unknown> | null } }).nightlyFixture.messageRequest());
  expect(request).toMatchObject({
    message: challenge.message, recipient: challenge.recipient, state: challenge.state,
    callbackUrl: challenge.callbackUrl, nonce: Array.from({ length: 32 }, (_, index) => index),
  });
  expect(sessionWrites, 'A rejected signature must never be exchanged for a support session').toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
});

test('claiming during an unfinished wallet switch cannot create a signing intent', async ({ page }) => {
  await injectNightly(page);
  await page.route('**/api/bounties/0', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...data, ...config }) });
  });
  await page.goto('/bounties/0');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /^Connect with Nightly/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim this bounty', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const fixture = window as unknown as { nightly: { near: { disconnect(): Promise<void>; signTransaction(): Promise<never> } }; walletSigningAttempts: number };
    fixture.walletSigningAttempts = 0;
    fixture.nightly.near.disconnect = () => new Promise<void>(() => {});
    fixture.nightly.near.signTransaction = async () => { fixture.walletSigningAttempts += 1; throw new Error('Fixture never signs'); };
  });
  await page.getByRole('button', { name: `Manage wallet ${accountId}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await page.getByRole('button', { name: /^Connect with MyNearWallet/ }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Connecting to MyNearWallet');
  await page.getByRole('button', { name: 'Close wallet dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Claim this bounty', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Finish connecting or switching your wallet');
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { walletSigningAttempts: number }).walletSigningAttempts)).toBe(0);
});


/** Deliberately invalid signature data is used only with an intercepted session
 * endpoint. These race checks do not prove cryptographic authentication. */
const delayedChallenge = {
  challengeId: 'delayed-sign-in-fixture', state: 'delayed-sign-in-fixture',
  message: 'Fixture delayed support challenge', recipient: 'gitsettle-ui.test',
  nonce: Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64'),
  callbackUrl: 'https://gitsettle-ui.test/support', expiresAt: new Date(Date.now() + 120_000).toISOString(),
};

async function beginDelayedSupportSignIn(page: Page) {
  await injectNightly(page);
  await page.route('**/api/auth/challenge', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ challenge: delayedChallenge }) }));
  await page.goto('/support');
  const { dialog } = await openPicker(page);
  await dialog.getByRole('button', { name: /^Connect with Nightly/ }).click();
  await expect(dialog).not.toBeVisible();
  await page.evaluate(() => (window as unknown as { nightlyFixture: { deferMessage(): void } }).nightlyFixture.deferMessage());
  await page.getByRole('button', { name: 'Sign in to support', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { nightlyFixture: { messageRequest(): unknown } }).nightlyFixture.messageRequest())).not.toBeNull();
}

test('support message signing blocks wallet switching and discards an extension account change', async ({ page }) => {
  let sessionWrites = 0;
  let sessionDeletes = 0;
  await page.route('**/api/auth/session', route => {
    if (route.request().method() === 'POST') sessionWrites += 1;
    if (route.request().method() === 'DELETE') sessionDeletes += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null }) });
  });
  await beginDelayedSupportSignIn(page);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.locator('.wallet-controls')).toContainText('maya');
  expect(sessionDeletes).toBe(0);
  await page.getByRole('button', { name: `Manage wallet ${accountId}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Connect with MyNearWallet/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Finish the current wallet');
  await page.getByRole('button', { name: 'Close wallet dialog', exact: true }).click();
  await page.evaluate(() => (window as unknown as { nightlyFixture: { switchAccount(next: string): void } }).nightlyFixture.switchAccount('translator.demo.testnet'));
  await expect(page.locator('.wallet-controls')).toContainText('translator');
  await expect.poll(() => sessionDeletes).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { nightlyFixture: { completeMessage(): void } }).nightlyFixture.completeMessage());
  await expect(page.getByRole('button', { name: 'Sign in to support', exact: true })).toBeVisible();
  expect(sessionWrites, 'The stale signature must never be exchanged for a support session').toBe(0);
  await expect(page.locator('.support-session')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

test('a delayed support session response is revoked after wallet disconnect', async ({ page, context }) => {
  let releaseResponse!: () => void;
  const delayedResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  let sessionWrites = 0;
  let sessionDeletes = 0;
  let privateReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/tickets') privateReads += 1; });
  await page.route('**/api/auth/session', async route => {
    const method = route.request().method();
    if (method === 'POST') {
      sessionWrites += 1;
      await delayedResponse;
      return route.fulfill({ contentType: 'application/json', headers: { 'Set-Cookie': 'gitsettle-late-session-fixture=fixture; Path=/; HttpOnly; SameSite=Lax' }, body: JSON.stringify({ session: { accountId, isAdmin: false, expiresAt: new Date(Date.now() + 3600000).toISOString() } }) });
    }
    if (method === 'DELETE') sessionDeletes += 1;
    return route.fulfill({ contentType: 'application/json', headers: method === 'DELETE' ? { 'Set-Cookie': 'gitsettle-late-session-fixture=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' } : {}, body: JSON.stringify({ session: null }) });
  });
  await beginDelayedSupportSignIn(page);
  await page.evaluate(() => (window as unknown as { nightlyFixture: { completeMessage(): void } }).nightlyFixture.completeMessage());
  await expect.poll(() => sessionWrites).toBe(1);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect.poll(() => sessionDeletes).toBeGreaterThan(0);
  const deletesBeforeResponse = sessionDeletes;
  const responseReceived = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/session' && response.request().method() === 'POST');
  releaseResponse();
  await responseReceived;
  await expect.poll(() => sessionDeletes, 'The late HttpOnly session must be explicitly revoked').toBeGreaterThan(deletesBeforeResponse);
  await expect(page.locator('.support-session')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await context.cookies()).filter(cookie => cookie.name === 'gitsettle-late-session-fixture')).toEqual([]);
  expect(privateReads, 'Cancelled identity must never load private conversations').toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});
