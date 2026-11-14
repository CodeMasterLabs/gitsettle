import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import type { Ticket, TicketMessage } from '../packages/community/src/types.ts';

/** UI response fixtures never stand in for real NEP-413 authorization or private storage tests. */
const account = 'maya.demo.testnet';
const initialTicket: Ticket = {
  id: 'ui-private-appeal', kind: 'appeal', subject: 'Please review the Spanish locale path', bountyId: 0,
  creatorAccount: account, posterAccount: 'maintainer.demo.testnet', status: 'open',
  createdAt: '2026-11-14T09:00:00.000Z', updatedAt: '2026-11-14T09:05:00.000Z', messageCount: 2,
  permissions: { canReply: true, canReview: false, canResolve: true },
};
const initialMessages: TicketMessage[] = [
  { id: 'message-one', ticketId: initialTicket.id, authorAccount: account, body: 'The pull request changes locales/es/messages.json. Could you check the locale rule again?', createdAt: '2026-11-14T09:00:00.000Z' },
  { id: 'message-two', ticketId: initialTicket.id, authorAccount: 'maintainer.demo.testnet', body: 'Thanks for the context. I will compare the merged diff with the issue requirements.', createdAt: '2026-11-14T09:05:00.000Z' },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function sessionFixture(page: Page, signedIn = true) {
  await page.route('**/api/auth/session', (route) => json(route, {
    session: signedIn && route.request().method() !== 'DELETE' ? { accountId: account, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), isAdmin: false } : null,
  }));
  await page.route('**/api/ai/chat', (route) => json(route, { configured: false }));
}

async function ticketFixture(page: Page) {
  let ticket = structuredClone(initialTicket);
  let messages = structuredClone(initialMessages);
  await page.route('**/api/tickets**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/tickets' && method === 'GET') return json(route, { tickets: [ticket] });
    if (path === '/api/tickets' && method === 'POST') {
      const input = route.request().postDataJSON();
      ticket = { ...ticket, id: 'ui-created-appeal', subject: input.subject, kind: input.kind, bountyId: input.bountyId ?? null, messageCount: 1 };
      messages = [{ ...messages[0], id: 'created-message', ticketId: ticket.id, body: input.body }];
      return json(route, { ticket, messages }, 201);
    }
    if (path.endsWith('/messages') && method === 'POST') {
      const input = route.request().postDataJSON();
      messages.push({ ...messages[0], id: `reply-${messages.length}`, body: input.body, createdAt: '2026-11-14T09:10:00.000Z' });
      ticket = { ...ticket, messageCount: messages.length };
      return json(route, { ticket, messages }, 201);
    }
    if (method === 'PATCH') {
      const input = route.request().postDataJSON();
      ticket = { ...ticket, status: input.status, permissions: { ...ticket.permissions, canReply: input.status !== 'resolved', canResolve: input.status !== 'resolved' } };
    }
    return json(route, { ticket, messages });
  });
}

async function captureAndCheck(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  const directory = resolve('docs/screenshots', info.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true, animations: 'disabled' });
}

test.beforeAll(async ({ request }) => {
  expect((await (await request.get('/api/config')).json()).mode).toBe('demo');
});

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript((theme) => localStorage.setItem('gitsettle.theme', theme), info.project.name === 'dark' ? 'dark' : 'light');
});

test('support explains private sign-in and an unconfigured AI provider', async ({ page }, info) => {
  await sessionFixture(page, false);
  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Keep the conversation private.' })).toBeVisible();
  await expect(page.getByText('AI help is not enabled on this instance. You can still open a private support ticket for a maintainer.')).toBeVisible();
  await expect(page.locator('.support-policy')).toContainText('do not pause deadlines or refunds');
  await expect(page.locator('.support-signin').getByRole('button', { name: 'Connect wallet', exact: true })).toBeDisabled();
  await captureAndCheck(page, info, 'support-signed-out');
});

test('private ticket fixture supports reply and terminal resolution', async ({ page }, info) => {
  await sessionFixture(page);
  await ticketFixture(page);
  await page.goto('/support');
  await expect(page.locator('.ticket-conversation-heading h2')).toHaveText(initialTicket.subject);
  await expect(page.locator('.ticket-message')).toHaveCount(2);
  await captureAndCheck(page, info, 'support-private-thread-fixture');
  await page.getByLabel('Reply to this conversation').fill('I added the exact file path and linked the merged commit above.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.locator('.ticket-message')).toHaveCount(3);
  await expect(page.getByLabel('Reply to this conversation')).toHaveValue('');
  await page.getByRole('button', { name: 'Resolve ticket', exact: true }).click();
  await expect(page.locator('.ticket-resolved')).toContainText('This ticket is resolved.');
  await expect(page.getByLabel('Reply to this conversation')).toHaveCount(0);
  await captureAndCheck(page, info, 'support-resolved-fixture');
});

test('appeal draft retains its bounty and describes off-chain limits', async ({ page }, info) => {
  await sessionFixture(page);
  await ticketFixture(page);
  await page.goto('/support?appeal=0');
  await expect(page.getByLabel('Conversation type')).toHaveValue('appeal');
  await expect(page.getByLabel('Bounty number', { exact: false })).toHaveValue('0');
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Appeal for bounty #0');
  await expect(page.locator('.support-policy')).toContainText('do not automatically change a verifier decision or reverse a payment');
  await page.getByLabel('Your message', { exact: true }).fill('Please review the merged translation file and the verification result.');
  await captureAndCheck(page, info, 'support-appeal-draft-fixture');
  await page.getByRole('button', { name: 'Open ticket', exact: true }).click();
  await expect(page.locator('.ticket-conversation-heading h2')).toHaveText('Appeal for bounty #0');
  await expect(page.locator('.ticket-message')).toHaveCount(1);
});

test('an inaccessible private ticket shows an error without a thread', async ({ page }, info) => {
  await sessionFixture(page);
  await page.route('**/api/tickets', (route) => json(route, { tickets: [] }));
  await page.route('**/api/tickets/hidden-ticket', (route) => json(route, { error: { code: 'not_found', message: 'This ticket was not found.' } }, 404));
  await page.goto('/support?ticket=hidden-ticket');
  await expect(page.getByRole('heading', { name: 'This view could not be loaded.' })).toBeVisible();
  await expect(page.locator('.ticket-message')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toContainText('This ticket was not found.');
  await captureAndCheck(page, info, 'support-private-error-fixture');
});

test('optional AI provider failures preserve the question and allow retry', async ({ page }, info) => {
  await sessionFixture(page);
  await page.route('**/api/tickets', (route) => json(route, { tickets: [] }));
  let fail = true;
  await page.route('**/api/ai/chat', (route) => route.request().method() === 'GET' ? json(route, { configured: true, model: 'fixture-model' }) : fail ? json(route, { error: { code: 'provider_unavailable', message: 'The configured AI provider is unavailable. Try again shortly.' } }, 503) : json(route, { configured: true, reply: 'Check that the merged PR changes an es locale path and includes the exact account binding. This is advice, not a payout decision.' }));
  await page.goto('/support');
  await page.getByLabel('Your question', { exact: true }).fill('Why does my Spanish translation need a matching locale path?');
  await page.getByRole('button', { name: 'Ask AI helper', exact: true }).click();
  await expect(page.locator('.ai-help').getByRole('alert')).toContainText('configured AI provider is unavailable');
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue('Why does my Spanish translation need a matching locale path?');
  await captureAndCheck(page, info, 'support-ai-error-fixture');
  fail = false;
  await page.getByRole('button', { name: 'Ask AI helper', exact: true }).click();
  await expect(page.locator('.ai-message-assistant')).toContainText('This is advice, not a payout decision.');
  await captureAndCheck(page, info, 'support-ai-reply-fixture');
});

test('post preflight exposes duplicates and the automatic payout cap', async ({ page }, info) => {
  await sessionFixture(page, false);
  await page.route('**/api/bounties', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await json(route, { ...data, automation: { agentGuardEnabled: true, maxAutomaticPayoutYocto: '5000000000000000000000000' } });
  });
  await page.route('**/api/triage', (route) => json(route, { duplicateBountyIds: [0], signals: [{ code: 'duplicate_issue', severity: 'high', message: 'An active bounty already funds this issue.' }], recommendation: 'duplicate', aiConfigured: false }));
  await page.goto('/bounties/new');
  await page.getByLabel('Issue URL', { exact: true }).fill('https://github.com/CodeMasterLabs/gitsettle/issues/1');
  await page.getByLabel('Reward (NEAR)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Review bounty', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Review matching bounty #0' })).toBeVisible();
  await expect(page.locator('.agentguard-notice')).toContainText('automated payout limit of 5.00 NEAR');
  await expect(page.getByLabel('I reviewed the matching bounties and still want to fund this issue again.')).not.toBeChecked();
  await page.getByLabel('I reviewed the matching bounties and still want to fund this issue again.').check();
  await expect(page.locator('.preflight-ai')).toContainText('AI review is not enabled');
  await captureAndCheck(page, info, 'post-duplicate-and-cap-fixture');
});

test('a mismatched signature redirect is scrubbed and never accepted as a session', async ({ page }, info) => {
  let sessionWrites = 0;
  await page.route('**/api/auth/session', (route) => { if (route.request().method() === 'POST') sessionWrites += 1; return json(route, { session: null }); });
  await page.route('**/api/ai/chat', (route) => json(route, { configured: false }));
  await page.addInitScript(() => sessionStorage.setItem('gitsettle.auth.v1', JSON.stringify({ challengeId: 'expected-challenge', accountId: 'maya.demo.testnet' })));
  await page.goto('/support#accountId=maya.demo.testnet&publicKey=ed25519%3Afixture&signature=fixture&state=different-challenge');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('did not match this browser’s request');
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(sessionWrites).toBe(0);
  await captureAndCheck(page, info, 'support-auth-error-fixture');
});

test('an expired session hides private content and prompts a fresh signature', async ({ page }, info) => {
  await sessionFixture(page);
  await page.route('**/api/tickets', (route) => json(route, { error: { code: 'unauthorized', message: 'Your support session expired.' } }, 401));
  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Keep the conversation private.' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your support session expired.');
  await expect(page.locator('.ticket-message')).toHaveCount(0);
  await captureAndCheck(page, info, 'support-session-expired-fixture');
});

test('support questions never send an appeal-only bounty field', async ({ page }) => {
  await sessionFixture(page);
  await ticketFixture(page);
  let submitted: Record<string, unknown> | null = null;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/tickets' && request.method() === 'POST') submitted = request.postDataJSON(); });
  await page.goto('/support');
  await expect(page.locator('.ticket-conversation-heading h2')).toBeVisible();
  await page.getByRole('button', { name: 'Open a ticket', exact: true }).click();
  await expect(page.getByLabel('Conversation type')).toHaveValue('support');
  await expect(page.getByLabel('Bounty number', { exact: true })).toHaveCount(0);
  await page.getByLabel('Subject', { exact: true }).fill('Clarify the supported locale paths');
  await page.getByLabel('Your message', { exact: true }).fill('Can a project put translation files under src/i18n/es.json?');
  await page.getByRole('button', { name: 'Open ticket', exact: true }).click();
  await expect(page.locator('.ticket-conversation-heading h2')).toHaveText('Clarify the supported locale paths');
  expect(submitted).toMatchObject({ kind: 'support' });
  expect(submitted).not.toHaveProperty('bountyId');
});

test('a standard NEP-413 error fragment is scrubbed without accepting authentication', async ({ page }) => {
  await sessionFixture(page, false);
  await page.addInitScript(() => sessionStorage.setItem('gitsettle.auth.v1', JSON.stringify({ challengeId: 'expected-challenge', accountId: 'maya.demo.testnet' })));
  await page.goto('/support#error=user_cancelled&state=expected-challenge');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('wallet did not complete the sign-in message');
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
});

test('matching callback metadata is forwarded to the server for signature verification', async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null;
  await page.route('**/api/auth/session', (route) => {
    if (route.request().method() === 'POST') requestBody = route.request().postDataJSON();
    return json(route, { session: { accountId: account, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), isAdmin: false } });
  });
  await page.route('**/api/ai/chat', (route) => json(route, { configured: false }));
  await ticketFixture(page);
  await page.addInitScript(() => sessionStorage.setItem('gitsettle.auth.v1', JSON.stringify({ challengeId: 'expected-challenge', accountId: 'maya.demo.testnet', returnTo: '/support' })));
  await page.goto('/support#accountId=maya.demo.testnet&publicKey=ed25519%3Asynthetic&signature=synthetic&state=expected-challenge');
  await expect(page.locator('.support-session')).toContainText(account);
  expect(requestBody).toEqual({ challengeId: 'expected-challenge', accountId: account, publicKey: 'ed25519:synthetic', signature: 'synthetic' });
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(await page.evaluate(() => sessionStorage.getItem('gitsettle.auth.v1'))).toBeNull();
});
