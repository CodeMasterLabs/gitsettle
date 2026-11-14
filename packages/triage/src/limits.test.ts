import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExpiringCache, PreflightLimiter, requestRateKey, SqliteAiQuota } from './limits.ts';
import { TriageError } from './types.ts';

test('anonymous limiter caps each identity at twenty per minute, with a bounded identity map', () => {
  let time = 0;
  const limiter = new PreflightLimiter(() => time);
  for (let i = 0; i < 20; i++) limiter.consume('one');
  assert.throws(() => limiter.consume('one'), (error: unknown) => error instanceof TriageError && error.code === 'triage_rate_limit' && error.retryAfter === 60);
  limiter.consume('two'); time = 60_000; limiter.consume('one');
  for (let i = 0; i < 1999; i++) limiter.consume(`identity-${i}`);
  assert.throws(() => limiter.consume('overflow'), (error: unknown) => error instanceof TriageError && error.code === 'triage_busy');
  time = 120_000; limiter.consume('overflow');
});

test('forwarded addresses affect anonymous buckets only behind an explicitly trusted proxy', () => {
  const request = (ip: string) => new Request('https://gitsettle.example/api/triage', { headers: { 'X-Forwarded-For': ip } });
  assert.equal(requestRateKey(request('192.0.2.1'), false), requestRateKey(request('192.0.2.2'), false));
  assert.notEqual(requestRateKey(request('192.0.2.1'), true), requestRateKey(request('192.0.2.2'), true));
  assert.equal(requestRateKey(request('192.0.2.1, 127.0.0.1'), true), requestRateKey(request('192.0.2.1'), true));
  assert.equal(requestRateKey(request('invalid'), true), requestRateKey(request('192.0.2.1'), false));
  assert.equal(requestRateKey(request('2001:db8::1'), true).length, 64);
});

test('cache isolates mutable values, expires after five minutes and evicts old entries at capacity', () => {
  let time = 0;
  const cache = new ExpiringCache<{ values: number[] }>(() => time, 2);
  const original = { values: [1] }; cache.set('a', original); original.values.push(2);
  const result = cache.get('a')!; result.values.push(3); assert.deepEqual(cache.get('a'), { values: [1] });
  cache.set('b', { values: [2] }); cache.set('c', { values: [3] });
  assert.equal(cache.get('a'), undefined); assert.deepEqual(cache.get('b'), { values: [2] });
  time = 299_999; assert.ok(cache.get('c')); time++; assert.equal(cache.get('c'), undefined);
});

test('AI quota persists and serializes independent connections, with separate wallets, sites and UTC days', t => {
  const directory = mkdtempSync(join(tmpdir(), 'gitsettle-quota-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'data', 'test.sqlite'); let time = 86_400_000 + 1000;
  const a = new SqliteAiQuota(file, 'site-a', () => time);
  const b = new SqliteAiQuota(file, 'site-a', () => time);
  const other = new SqliteAiQuota(file, 'site-b', () => time);
  t.after(() => { a.close(); b.close(); other.close(); });
  for (let i = 0; i < 20; i++) (i % 2 ? a : b).consume('alice.testnet');
  for (const quota of [a, b]) assert.throws(() => quota.consume('alice.testnet'), (error: unknown) => error instanceof TriageError && error.code === 'ai_daily_quota' && error.retryAfter === 86_399);
  b.consume('bob.testnet'); other.consume('alice.testnet');
  const reopened = new SqliteAiQuota(file, 'site-a', () => time);
  assert.throws(() => reopened.consume('alice.testnet')); reopened.close();
  time = 2 * 86_400_000; a.consume('alice.testnet');
});
