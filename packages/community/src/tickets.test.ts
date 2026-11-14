import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunityTickets } from './tickets.ts';
import { CommunityError } from './errors.ts';
import { account, bounty, fixture, viewer } from './test-fixture.ts';

const code = (expected: string) => (error: unknown) => error instanceof CommunityError && error.code === expected;
const support = (body = 'My wallet opens a blank confirmation screen.') => ({ kind: 'support', subject: 'Wallet connection', body });
const appeal = () => ({ kind: 'appeal', subject: 'Review my Spanish translation', body: 'The merged change includes locales/es/common.json.', bountyId: 9 });

test('support creator and admin have access; another wallet and unrelated poster cannot enumerate tickets', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const result = await f.tickets.create({ ...support(), creatorAccount: 'attacker.testnet', isAdmin: true }, viewer());
  assert.equal(result.ticket.creatorAccount, account);
  assert.equal(result.messages[0].authorAccount, account);
  assert.equal(result.ticket.posterAccount, null);
  for (const outsider of ['bob.testnet', 'poster.testnet']) {
    assert.deepEqual(f.tickets.list(viewer(outsider)), { tickets: [] });
    assert.throws(() => f.tickets.detail(result.ticket.id, viewer(outsider)), code('ticket_not_found'));
    assert.throws(() => f.tickets.reply(result.ticket.id, { body: 'intrusion' }, viewer(outsider)), code('ticket_not_found'));
    assert.throws(() => f.tickets.update(result.ticket.id, { status: 'resolved' }, viewer(outsider)), code('ticket_not_found'));
  }
  assert.equal(f.tickets.list(viewer('admin.testnet', true)).tickets.length, 1);
  assert.equal(f.tickets.detail(result.ticket.id, viewer('admin.testnet', true)).messages.length, 1);
});

test('appeal requires real claimant; poster/admin can review and claimant can close', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const original = bounty(); f.setBounty(original);
  await assert.rejects(f.tickets.create({ ...appeal(), claimant: account }, viewer('impostor.testnet')), code('claimant_required'));
  const result = await f.tickets.create(appeal(), viewer());
  assert.equal(result.ticket.posterAccount, 'poster.testnet');
  assert.equal(result.ticket.permissions.canReview, false);
  assert.throws(() => f.tickets.update(result.ticket.id, { status: 'in_review' }, viewer()), code('reviewer_required'));
  const reviewed = f.tickets.update(result.ticket.id, { status: 'in_review' }, viewer('poster.testnet'));
  assert.equal(reviewed.ticket.status, 'in_review');
  f.tickets.reply(result.ticket.id, { body: 'I will review the locale evidence.', authorAccount: account }, viewer('poster.testnet'));
  assert.equal(f.tickets.detail(result.ticket.id, viewer()).messages[1].authorAccount, 'poster.testnet');
  assert.equal(f.tickets.update(result.ticket.id, { status: 'resolved' }, viewer()).ticket.status, 'resolved');
  assert.deepEqual(original, bounty(), 'discussion did not mutate bounty, deadline, status, reward, or claimant');
});

test('both Submitted and Rejected appeals work; every other on-chain status fails', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const status of ['Open', 'Claimed', 'Releasing', 'Released', 'Refunding', 'Refunded'] as const) {
    f.setBounty(bounty({ status }));
    await assert.rejects(f.tickets.create(appeal(), viewer()), code('appeal_unavailable'));
  }
  f.setBounty(bounty({ status: 'Rejected' }));
  assert.equal((await f.tickets.create(appeal(), viewer())).ticket.kind, 'appeal');
});

test('missing/unavailable chain state never falls back to demo ownership', async t => {
  const f = fixture(); t.after(() => f.db.close());
  f.setBounty(null);
  await assert.rejects(f.tickets.create(appeal(), viewer()), code('bounty_not_found'));
  f.setBounty(bounty({ claimant: null }));
  await assert.rejects(f.tickets.create(appeal(), viewer()), code('claimant_required'));
  f.failBounty();
  await assert.rejects(f.tickets.create(appeal(), viewer()), code('near_unavailable'));
  assert.equal(f.tickets.list(viewer()).tickets.length, 0);
  assert.equal((await f.tickets.create(support(), viewer())).ticket.kind, 'support', 'general support does not depend on bounty RPC');
});

test('duplicate appeals are blocked; resolved conversations cannot reply or reopen', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const created = await f.tickets.create(appeal(), viewer());
  await assert.rejects(f.tickets.create({ ...appeal(), body: 'Another description' }, viewer()), code('appeal_exists'));
  f.tickets.update(created.ticket.id, { status: 'resolved' }, viewer('admin.testnet', true));
  const closed = f.tickets.detail(created.ticket.id, viewer());
  assert.deepEqual(closed.ticket.permissions, { canReply: false, canReview: false, canResolve: false });
  assert.throws(() => f.tickets.reply(created.ticket.id, { body: 'New evidence' }, viewer()), code('ticket_resolved'));
  assert.throws(() => f.tickets.update(created.ticket.id, { status: 'in_review' }, viewer('admin.testnet', true)), code('ticket_resolved'));
});

test('ticket creation rate is three per hour per session identity, including resolved tickets', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (let i = 0; i < 3; i++) {
    const created = await f.tickets.create(support(`Independent question ${i}`), viewer());
    f.tickets.update(created.ticket.id, { status: 'resolved' }, viewer());
  }
  await assert.rejects(f.tickets.create({ ...support('Fourth question'), accountId: 'bob.testnet' }, viewer()), code('rate_limited'));
  assert.equal(f.tickets.list(viewer()).tickets.length, 3);
  assert.equal((await f.tickets.create(support('Fourth question'), viewer('bob.testnet'))).ticket.creatorAccount, 'bob.testnet');
  f.advance(3_600_000);
  assert.equal((await f.tickets.create(support('After the hour'), viewer())).ticket.status, 'open');
});

test('messages are limited to twenty per minute across conversations, with atomic no-write rejection', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const created = await f.tickets.create(support(), viewer());
  for (let i = 0; i < 19; i++) f.tickets.reply(created.ticket.id, { body: `Additional diagnostic ${i}` }, viewer());
  assert.throws(() => f.tickets.reply(created.ticket.id, { body: 'Twenty first message', authorAccount: 'bob.testnet' }, viewer()), code('rate_limited'));
  assert.equal(f.tickets.detail(created.ticket.id, viewer()).messages.length, 20);
  f.advance(60_000);
  assert.equal(f.tickets.reply(created.ticket.id, { body: 'After a minute' }, viewer()).messages.length, 21);
});

test('normalized repeated-text spam is blocked across threads without penalizing other authors', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const first = await f.tickets.create(support('Please review my wallet connection'), viewer());
  const second = await f.tickets.create(support('Different question'), viewer());
  assert.throws(() => f.tickets.reply(second.ticket.id, { body: '  PLEASE  review\nmy wallet connection  ' }, viewer()), code('repeated_text'));
  assert.equal(f.tickets.reply(first.ticket.id, { body: 'Please review my wallet connection' }, viewer('admin.testnet', true)).messages.length, 2);
  f.advance(3_600_000);
  assert.equal(f.tickets.reply(second.ticket.id, { body: 'Please review my wallet connection' }, viewer()).messages.length, 2);
});

test('input lengths, malformed IDs, support bounty injection, and invalid transitions are rejected', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const invalid of [
    { ...support(), subject: 'x'.repeat(121) }, { ...support(), body: 'x'.repeat(4001) },
    { ...support(), body: '\u0000' }, { ...support(), kind: 'payout' }, { ...support(), bountyId: 9 },
    { ...appeal(), bountyId: -1 }, { ...appeal(), bountyId: 0.5 }, { ...appeal(), bountyId: '9' },
  ]) await assert.rejects(f.tickets.create(invalid, viewer()), code('invalid_input'));
  const result = await f.tickets.create(support(), viewer());
  assert.throws(() => f.tickets.update(result.ticket.id, { status: 'Released' }, viewer('admin.testnet', true)), code('invalid_input'));
  assert.equal(f.tickets.detail(result.ticket.id, viewer()).ticket.status, 'open');
});

test('deployment namespaces isolate tickets even for an admin sharing the same SQLite file', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const result = await f.tickets.create(support(), viewer());
  const other = new CommunityTickets({ db: f.db, namespace: 'another-contract', getBounty: async () => bounty() });
  const admin = viewer('admin.testnet', true);
  assert.deepEqual(other.list(admin), { tickets: [] });
  assert.throws(() => other.detail(result.ticket.id, admin), code('ticket_not_found'));
});
