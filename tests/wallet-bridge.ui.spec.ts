import { expect, test, type Page } from '@playwright/test';
import pinnedManifest from '../apps/web/src/lib/wallet-manifest.json' with { type: 'json' };

const accountId = 'bridge-fixture.testnet';
const config = { mode: 'testnet', network: 'testnet', contractId: 'ui-fixture.testnet', rpcUrl: 'https://test.rpc.fastnear.com' };
const executorRoute = /(?:meteor-near-connect-latest|intear-executor-[a-f0-9]+)\.js(?:\?.*)?$/;

/** A provider fixture runs inside the actual NEAR Connect sandbox. It observes
 * only unsigned requests, returns a fixture identity, and refuses every signing
 * operation. This is bridge coverage, not live wallet or financial evidence. */
const executorFixture = `
  const accountId = 'bridge-fixture.testnet';
  function report(method, params) {
    const payload = { ...params };
    if (payload.nonce) payload.nonce = Array.from(payload.nonce);
    window.parent.postMessage({ type: 'gitsettle-bridge-fixture', method, params: payload }, '*');
  }
  window.selector.ready({
    async signIn(params) { report('signIn', params); await window.selector.storage.set('fixture-account', accountId); return [{ accountId }]; },
    async getAccounts() { return await window.selector.storage.get('fixture-account') ? [{ accountId }] : []; },
    async signOut(params) { report('signOut', params); await window.selector.storage.remove('fixture-account'); },
    async signMessage(params) { report('signMessage', params); throw new Error('Fixture refuses all signing'); },
    async signAndSendTransaction(params) { report('signAndSendTransaction', params); throw new Error('Fixture refuses all signing'); },
    async signAndSendTransactions(params) { report('signAndSendTransactions', params); throw new Error('Fixture refuses all signing'); },
  });
`;

async function prepare(page: Page) {
  await page.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) }));
  await page.route('**/api/auth/session', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null }) }));
  await page.route(executorRoute, route => route.fulfill({ contentType: 'application/javascript', body: executorFixture }));
  await page.addInitScript(() => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    Object.assign(window, { bridgeFixtureCalls: calls });
    window.addEventListener('message', event => {
      if (event.data?.type === 'gitsettle-bridge-fixture') calls.push({ method: event.data.method, params: event.data.params });
    });
  });
}

async function connect(page: Page, provider: string) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Connect a wallet', exact: true }).getByRole('button', { name: `Connect with ${provider}`, exact: false }).click();
  await expect(page.getByRole('button', { name: `Manage wallet ${accountId}`, exact: true })).toBeVisible();
}

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { bridgeFixtureCalls: Array<{ method: string; params: Record<string, unknown> }> }).bridgeFixtureCalls);
}

test.beforeEach(async ({ page }) => prepare(page));

test('the shipped Intear executor starts its sandbox pairing flow and handles cancellation', async ({ page }) => {
  // Keep the actual local executable. Only the external provider-owned pairing
  // screen is replaced, and it refuses connection without signing anything.
  await page.unroute(executorRoute);
  await page.route('**/hot-wallet-connector-iframe.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><h1>Fixture Intear pairing screen</h1><button id="cancel">Cancel pairing</button><script>document.getElementById("cancel").onclick=()=>window.parent.postMessage({type:"close",message:"User rejected the connection"},"*")</script></body></html>',
  }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const executor = pinnedManifest.wallets.find(wallet => wallet.id === 'intear-wallet')!.executor;
  const response = page.waitForResponse(value => new URL(value.url()).pathname === executor);
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^Connect with Intear Wallet/ }).click();
  expect((await response).status()).toBe(200);
  const pairing = page.frameLocator('iframe[srcdoc]').frameLocator('iframe[src*="hot-wallet-connector-iframe.html"]');
  await expect(pairing.getByRole('heading', { name: 'Fixture Intear pairing screen', exact: true })).toBeVisible();
  await pairing.getByRole('button', { name: 'Cancel pairing', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('No account was returned');
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: /^Manage wallet / })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
});

for (const provider of ['Meteor Wallet', 'Intear Wallet']) {
  test(`${provider} sandbox receives testnet identity request without transaction keys`, async ({ page }) => {
    await page.goto('/');
    await connect(page, provider);
    const request = (await calls(page)).find(call => call.method === 'signIn');
    expect(request).toBeTruthy();
    expect(request!.params.network).toBe('testnet');
    expect(request!.params.contractId).toBeUndefined();
    expect(request!.params.addFunctionCallKey).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('functionCallKey'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true }).first()).toBeVisible();
    expect((await calls(page)).find(call => call.method === 'signOut')?.params.network).toBe('testnet');
  });
}

for (const provider of ['Meteor Wallet', 'Intear Wallet']) {
  test(`${provider} support honors the provider's complete-challenge capability`, async ({ page }) => {
    const challenge = { challengeId: 'bridge-challenge', state: 'bridge-challenge', message: 'Fixture support challenge', recipient: 'gitsettle.test', nonce: Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64'), callbackUrl: 'https://gitsettle.test/support', expiresAt: new Date(Date.now() + 120000).toISOString() };
    let sessionWrites = 0;
    await page.route('**/api/auth/challenge', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ challenge }) }));
    await page.route('**/api/auth/session', route => {
      if (route.request().method() === 'POST') sessionWrites += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null }) });
    });
    await page.goto('/support');
    await connect(page, provider);
    await page.getByRole('button', { name: 'Sign in to support', exact: true }).click();
    const alert = page.getByRole('main').getByRole('alert');
    if (provider === 'Meteor Wallet') {
      await expect(alert).toContainText('Fixture refuses all signing');
      expect((await calls(page)).find(call => call.method === 'signMessage')?.params).toMatchObject({ network: 'testnet', message: challenge.message, recipient: challenge.recipient, callbackUrl: challenge.callbackUrl, state: challenge.state, nonce: Array.from({ length: 32 }, (_, index) => index) });
    } else {
      await expect(alert).toContainText('cannot sign the complete support challenge');
      expect((await calls(page)).some(call => call.method === 'signMessage')).toBe(false);
    }
    expect(sessionWrites).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('gitsettle.pending.v1'))).toBeNull();
  });
}
