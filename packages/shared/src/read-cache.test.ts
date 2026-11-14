import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadModelCache } from './read-cache.ts';

test('slow concurrent reads coalesce and their five-second lifetime starts after success', async () => {
  let now = 0;
  const cache = new ReadModelCache(() => now);
  let resolve!: (value: number) => void;
  let calls = 0;
  const load = () => { calls++; return new Promise<number>(done => { resolve = done; }); };
  const first = cache.get('board', load);
  await Promise.resolve();
  now = 10_000;
  const concurrent = cache.get('board', load);
  assert.equal(calls, 1);
  resolve(9);
  assert.equal(await first, 9);
  assert.equal(await concurrent, 9);
  now = 14_999;
  assert.equal(await cache.get('board', async () => 99), 9);
  now = 15_000;
  assert.equal(await cache.get('board', async () => 10), 10);
});

test('failed refreshed reads never serve expired monetary snapshots or poison future attempts', async () => {
  let now = 0;
  const cache = new ReadModelCache(() => now);
  assert.equal(await cache.get('balance', async () => '1'), '1');
  now = 5000;
  await assert.rejects(cache.get('balance', async () => { throw new Error('RPC unavailable'); }));
  assert.equal(await cache.get('balance', async () => '2'), '2');
});

test('confirmation invalidation prevents an old in-flight snapshot from replacing fresh data', async () => {
  const cache = new ReadModelCache();
  let finish!: (value: string) => void;
  const old = cache.get('bounty', () => new Promise<string>(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('bounty', async () => 'Released'), 'Released');
  finish('Submitted');
  await old;
  assert.equal(await cache.get('bounty', async () => 'unexpected'), 'Released');
});

test('failure of superseded work cannot evict a newer successful refresh', async () => {
  const cache = new ReadModelCache();
  let fail!: (error: Error) => void;
  const old = cache.get('board', () => new Promise<number>((_, reject) => { fail = reject; }));
  await Promise.resolve();
  assert.equal(await cache.get('board', async () => 10, true), 10);
  fail(new Error('old failure'));
  await assert.rejects(old);
  assert.equal(await cache.get('board', async () => 99), 10);
});

test('composite profile responses cannot extend the lifetime of an older board snapshot', async () => {
  let now = 4000;
  const cache = new ReadModelCache(() => now);
  await cache.get('profile', async () => ({ updatedAt: 0, state: 'Submitted' }));
  now = 5000;
  const refreshed = await cache.get('profile', async () => ({ updatedAt: 5000, state: 'Released' }));
  assert.equal(refreshed.state, 'Released');
});
