import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCommunityRequest, cookieNames, requireSession } from './http.ts';
import { communityOrigin } from './server.ts';
import { fixture, account, ORIGIN } from './test-fixture.ts';
import type { AuthChallenge } from './types.ts';

const request = (path: string, method = 'GET', body?: unknown, cookie?: string, origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
  method, headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

test('HTTP complete challenge/sign/session/support/logout uses secure cookies and never returns secrets', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const first = await handleCommunityRequest(request('/api/auth/challenge', 'POST', { accountId: account }), 'challenge', undefined, f.services);
  assert.equal(first.status, 200);
  const challengeCookie = first.headers.getSetCookie()[0];
  assert.match(challengeCookie, /__Host-gitsettle_challenge=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300; Secure/);
  const { challenge } = await first.json() as { challenge: AuthChallenge };
  const proof = await f.sign(challenge);
  const second = await handleCommunityRequest(request('/api/auth/session', 'POST', proof, challengeCookie.split(';')[0]), 'session', undefined, f.services);
  assert.equal(second.status, 200);
  const result = await second.json();
  assert.deepEqual(Object.keys(result), ['session']);
  assert.equal(result.session.accountId, account);
  const sessionCookie = second.headers.getSetCookie()[0];
  assert.match(sessionCookie, /__Host-gitsettle_session=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
  const cookie = sessionCookie.split(';')[0];
  const ticket = await handleCommunityRequest(request('/api/tickets', 'POST', {
    kind: 'support', subject: 'Question', body: 'Please help with my wallet.', accountId: 'attacker.testnet', isAdmin: true,
  }, cookie), 'tickets', undefined, f.services);
  assert.equal(ticket.status, 201);
  assert.equal((await ticket.json()).ticket.creatorAccount, account);
  const session = await handleCommunityRequest(request('/api/auth/session', 'GET', undefined, cookie), 'session', undefined, f.services);
  assert.equal((await session.json()).session.accountId, account);
  const logout = await handleCommunityRequest(request('/api/auth/session', 'DELETE', undefined, cookie), 'session', undefined, f.services);
  assert.equal(logout.status, 200);
  const after = await handleCommunityRequest(request('/api/tickets', 'GET', undefined, cookie), 'tickets', undefined, f.services);
  assert.equal(after.status, 401);
});

test('all mutation endpoints reject missing/cross-site Origin, even with a valid session', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { token } = await f.login();
  const cookie = `${cookieNames(ORIGIN).session}=${token}`;
  for (const resource of ['challenge', 'session', 'tickets', 'ticket', 'messages'] as const) {
    const response = await handleCommunityRequest(request('/api/example', 'POST', { accountId: account }, cookie, 'https://attacker.example'), resource, 'id', f.services);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'origin_mismatch');
  }
  const noOrigin = new Request(`${ORIGIN}/api/auth/session`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal((await handleCommunityRequest(noOrigin, 'session', undefined, f.services)).status, 403);
});

test('anonymous/forged sessions cannot use tickets, and duplicate cookies are rejected', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { token } = await f.login();
  const name = cookieNames(ORIGIN).session;
  for (const cookie of [undefined, `${name}=${'x'.repeat(43)}`, `${name}=${token}; ${name}=${token}`]) {
    const response = await handleCommunityRequest(request('/api/tickets?accountId=alice.testnet', 'GET', undefined, cookie), 'tickets', undefined, f.services);
    assert.equal(response.status, 401);
  }
});

test('private helper endpoints reuse verified identity and reject cross-origin mutations', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { token } = await f.login();
  const cookie = `${cookieNames(ORIGIN).session}=${token}`;
  const session = await requireSession(request('/api/ai/chat', 'POST', { accountId: 'attacker.testnet' }, cookie), f.services);
  assert.equal(session.accountId, account);
  await assert.rejects(requireSession(request('/api/ai/chat', 'POST', {}, cookie, 'https://attacker.example'), f.services));
  f.setPermission('missing');
  await assert.rejects(requireSession(request('/api/ai/chat', 'POST', {}, cookie), f.services));
});

test('request stream size, JSON content type, and safe errors are enforced', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const huge = request('/api/auth/challenge', 'POST', { accountId: 'x'.repeat(33_000) });
  assert.equal((await handleCommunityRequest(huge, 'challenge', undefined, f.services)).status, 413);
  const form = new Request(`${ORIGIN}/api/auth/challenge`, { method: 'POST', headers: { Origin: ORIGIN }, body: 'accountId=alice.testnet' });
  assert.equal((await handleCommunityRequest(form, 'challenge', undefined, f.services)).status, 415);
  const { token } = await f.login(); f.setPermission('unavailable');
  const response = await handleCommunityRequest(request('/api/tickets', 'GET', undefined, `${cookieNames(ORIGIN).session}=${token}`), 'tickets', undefined, f.services);
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(!text.includes('private RPC') && !text.includes(token));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('canonical origin accepts HTTPS/local development and rejects arbitrary HTTP or path URLs', () => {
  const original = process.env.APP_ORIGIN;
  try {
    for (const value of ['https://gitsettle.example', 'http://localhost:3000']) { process.env.APP_ORIGIN = value; assert.equal(communityOrigin(), value); }
    for (const value of ['http://gitsettle.example', 'https://gitsettle.example/support', 'https://gitsettle.example/', 'https://name:password@gitsettle.example']) {
      process.env.APP_ORIGIN = value; assert.throws(communityOrigin);
    }
  } finally { if (original === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = original; }
});
