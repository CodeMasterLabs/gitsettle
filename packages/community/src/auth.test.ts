import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunityAuth, CHALLENGE_TTL_MS, CHALLENGES_PER_MINUTE, SESSION_TTL_MS, hashSecret } from './auth.ts';
import { CommunityError } from './errors.ts';
import { fixture, account, ORIGIN } from './test-fixture.ts';

const code = (expected: string) => (error: unknown) => error instanceof CommunityError && error.code === expected;

test('NEP-413: real signature creates an opaque hashed session and forces finalized state', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const result = await f.login();
  assert.equal(result.session.accountId, account);
  assert.equal(result.session.isAdmin, false);
  const stored = f.db.prepare('SELECT * FROM community_sessions').get() as Record<string, unknown>;
  assert.equal(stored.token_hash, hashSecret(result.token));
  assert.ok(!JSON.stringify(stored).includes(result.token));
  assert.deepEqual(await f.auth.getSession(result.token), result.session);
  assert.equal(f.queries.length, 2);
  for (const query of f.queries) assert.deepEqual(query.finalityQuery, { finality: 'final' });
});

test('challenge nonce is 32 random bytes bound to account, origin, callback, and five-minute expiry', t => {
  const f = fixture(); t.after(() => f.db.close());
  const a = f.auth.createChallenge({ accountId: account });
  const b = f.auth.createChallenge({ accountId: account });
  assert.equal(Buffer.from(a.challenge.nonce, 'base64').length, 32);
  assert.notEqual(a.challenge.nonce, b.challenge.nonce);
  assert.equal(a.challenge.recipient, new URL(ORIGIN).host);
  assert.equal(a.challenge.callbackUrl, `${ORIGIN}/support`);
  assert.ok(a.challenge.message.includes(account));
  assert.equal(Date.parse(a.challenge.expiresAt), 1_800_000_000_000 + CHALLENGE_TTL_MS);
});

for (const field of ['message', 'recipient', 'callbackUrl', 'nonce'] as const) {
  test(`NEP-413 forgery: altered ${field} fails and burns the challenge`, async t => {
    const f = fixture(); t.after(() => f.db.close());
    const challenge = f.auth.createChallenge({ accountId: account });
    const changed = field === 'nonce' ? Buffer.alloc(32).toString('base64') : 'https://attacker.example';
    await assert.rejects(f.auth.establishSession(await f.sign(challenge.challenge, { [field]: changed }), challenge.browserToken), code('invalid_signature'));
    await assert.rejects(f.auth.establishSession(await f.sign(challenge.challenge), challenge.browserToken), code('invalid_challenge'));
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM community_sessions').get() as { n: number }).n, 0);
  });
}

test('single-use challenge allows exactly one concurrent establishment', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { challenge, browserToken } = f.auth.createChallenge({ accountId: account });
  const proof = await f.sign(challenge);
  const attempts = await Promise.allSettled([f.auth.establishSession(proof, browserToken), f.auth.establishSession(proof, browserToken)]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(value => value.status === 'rejected').length, 1);
});

test('wrong browser, account, and expired challenges cannot authenticate', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { challenge, browserToken } = f.auth.createChallenge({ accountId: account });
  const proof = await f.sign(challenge);
  await assert.rejects(f.auth.establishSession(proof, 'a'.repeat(43)), code('invalid_challenge'));
  await assert.rejects(f.auth.establishSession({ ...proof, accountId: 'attacker.testnet' }, browserToken), code('invalid_challenge'));
  f.advance(CHALLENGE_TTL_MS);
  await assert.rejects(f.auth.establishSession(proof, browserToken), code('invalid_challenge'));
});

test('FunctionCall keys, missing keys, malformed and forged signatures fail closed', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const permission of ['FunctionCall', 'missing'] as const) {
    f.setPermission(permission);
    const { challenge, browserToken } = f.auth.createChallenge({ accountId: account });
    await assert.rejects(f.auth.establishSession(await f.sign(challenge), browserToken), code('key_not_authorized'));
  }
  f.setPermission('FullAccess');
  const { challenge, browserToken } = f.auth.createChallenge({ accountId: account });
  const proof = await f.sign(challenge);
  await assert.rejects(f.auth.establishSession({ ...proof, signature: 'notbase64' }, browserToken), code('invalid_input'));
  await assert.rejects(f.auth.establishSession({ ...proof, signature: Buffer.alloc(64).toString('base64') }, browserToken), code('invalid_signature'));
});

test('revoked key invalidates an existing session; RPC failure cannot authenticate or leak context', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const first = await f.login();
  f.setPermission('missing');
  assert.equal(await f.auth.getSession(first.token), null);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM community_sessions').get() as { n: number }).n, 0);
  f.setPermission('FullAccess');
  const second = await f.login();
  f.setPermission('unavailable');
  await assert.rejects(f.auth.getSession(second.token), code('near_unavailable'));
  f.setPermission('FullAccess');
  assert.equal((await f.auth.getSession(second.token))?.accountId, account);
});

test('sessions expire, rotate, log out, and remain isolated between configured origins', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const first = await f.login();
  const different = new CommunityAuth({ ...f.options, namespace: 'other-origin', origin: 'https://other.example' });
  assert.equal(await different.getSession(first.token), null);
  const { challenge, browserToken } = f.auth.createChallenge({ accountId: account });
  const next = await f.auth.establishSession(await f.sign(challenge), browserToken, first.token);
  assert.equal(await f.auth.getSession(first.token), null);
  f.advance(SESSION_TTL_MS);
  assert.equal(await f.auth.getSession(next.token), null);
  const last = await f.login(); f.auth.logout(last.token);
  assert.equal(await f.auth.getSession(last.token), null);
  assert.equal(await f.auth.getSession('fake-token'), null);
});

test('challenge issuance is bounded and admin status derives from server configuration', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let i = 0; i < 10; i++) f.auth.createChallenge({ accountId: account, isAdmin: true });
  assert.throws(() => f.auth.createChallenge({ accountId: account }), code('rate_limited'));
  assert.equal((await f.login('admin.testnet')).session.isAdmin, true);
});

test('expiry while waiting for finalized key state cannot revive a session', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { token } = await f.login();
  const delayed = new CommunityAuth({ ...f.options, provider: { viewAccessKey: async args => {
    f.advance(SESSION_TTL_MS); return f.options.provider.viewAccessKey(args);
  } } });
  assert.equal(await delayed.getSession(token), null);
});

test('logout during a finalized-key RPC read cannot return a stale authenticated session', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const { token } = await f.login();
  const concurrent = new CommunityAuth({ ...f.options, provider: { viewAccessKey: async args => {
    f.auth.logout(token); return f.options.provider.viewAccessKey(args);
  } } });
  assert.equal(await concurrent.getSession(token), null);
});

test('rotating invented accounts cannot bypass the shared anonymous challenge ceiling', t => {
  const f = fixture(); t.after(() => f.db.close());
  const second = new CommunityAuth(f.options);
  for (let i = 0; i < CHALLENGES_PER_MINUTE; i++) (i % 2 ? f.auth : second).createChallenge({ accountId: `invented-${i}.testnet` });
  assert.throws(() => second.createChallenge({ accountId: 'another-invented.testnet' }), code('rate_limited'));
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM community_challenges').get() as { n: number }).n, CHALLENGES_PER_MINUTE);
  f.advance(60_000);
  second.createChallenge({ accountId: 'after-one-minute.testnet' });
  f.advance(CHALLENGE_TTL_MS - 60_000);
  second.createChallenge({ accountId: 'after-five-minutes.testnet' });
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM community_challenges').get() as { n: number }).n, 2, 'expired challenge payloads are pruned instead of retained for a day');
});
