import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicViewCache } from './public-cache.ts';

test('navigation shares in-flight public reads and expires five seconds after completion', async () => {
  let time = 0;
  let calls = 0;
  let finish!: (value: unknown) => void;
  const cache = new PublicViewCache(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => time);
  const first = cache.read('/api/bounties');
  const second = cache.read('/api/bounties');
  assert.equal(calls, 1);
  time = 9_000;
  finish({ status: 'Released' });
  assert.deepEqual(await first, await second);
  time = 13_999;
  assert.deepEqual(cache.peek('/api/bounties'), { status: 'Released' });
  time = 14_000;
  assert.equal(cache.peek('/api/bounties'), null);
});

test('confirmed-transaction invalidation cannot be overwritten by an older pending read', async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  const cache = new PublicViewCache(() => new Promise(resolve => resolvers.push(resolve)));
  const old = cache.read('/api/bounties/8');
  cache.invalidate();
  const fresh = cache.read('/api/bounties/8');
  resolvers[1]({ status: 'Released' });
  await fresh;
  resolvers[0]({ status: 'Submitted' });
  await old;
  assert.deepEqual(cache.peek('/api/bounties/8'), { status: 'Released' });
});

test('errors do not become cached data and a retry can recover', async () => {
  let calls = 0;
  const cache = new PublicViewCache(async () => { if (++calls === 1) throw new Error('RPC unavailable'); return []; });
  await assert.rejects(cache.read('/api/leaderboard'), /RPC unavailable/);
  assert.equal(cache.peek('/api/leaderboard'), null);
  assert.deepEqual(await cache.read('/api/leaderboard'), []);
  assert.equal(calls, 2);
});

test('private conversations, auth, provider calls and foreign origins are never cached', async () => {
  let calls = 0;
  const cache = new PublicViewCache(async () => { calls++; return {}; });
  for (const url of ['/api/tickets', '/api/auth/session', '/api/ai/chat', 'https://example.org/api/bounties', '/api/bounties?session=secret']) {
    await assert.rejects(cache.read(url), /public contract views only/);
  }
  assert.equal(calls, 0);
});

test('navigation memory is bounded and account profiles never alias one another', async () => {
  const cache = new PublicViewCache(async url => ({ account: url }));
  for (let index = 0; index <= 100; index++) await cache.read(`/api/contributors/user${index}.testnet`);
  assert.equal(cache.peek('/api/contributors/user0.testnet'), null);
  assert.deepEqual(cache.peek('/api/contributors/user100.testnet'), { account: '/api/contributors/user100.testnet' });
  cache.invalidate('/api/contributors/user100.testnet');
  assert.equal(cache.peek('/api/contributors/user100.testnet'), null);
});

test('browser cache does not extend an aged server snapshot lifetime', async () => {
  let time = 5_000;
  const cache = new PublicViewCache(async () => ({ updatedAt: 2_000, points: 100 }), () => time);
  await cache.read('/api/leaderboard');
  time = 6_999;
  assert.notEqual(cache.peek('/api/leaderboard'), null);
  time = 7_000;
  assert.equal(cache.peek('/api/leaderboard'), null);
});
