import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openCommunityStore } from './store.ts';
import { CommunityTickets } from './tickets.ts';
import { bounty, viewer } from './test-fixture.ts';

test('additive WAL schema persists across connections and enforces shared rate limits', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gitsettle-community-'));
  const file = join(dir, 'shared.sqlite');
  const existing = new Database(file);
  existing.exec("CREATE TABLE bounty_metadata (key TEXT PRIMARY KEY,title TEXT); INSERT INTO bounty_metadata VALUES ('test:9','Spanish translation'); PRAGMA user_version=1;");
  existing.close();
  const a = openCommunityStore(file);
  const b = openCommunityStore(file);
  t.after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(a.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(a.pragma('user_version', { simple: true }), 1);
  assert.deepEqual(a.prepare('SELECT * FROM bounty_metadata').get(), { key: 'test:9', title: 'Spanish translation' });
  const one = new CommunityTickets({ db: a, namespace: 'test', getBounty: async () => bounty() });
  const two = new CommunityTickets({ db: b, namespace: 'test', getBounty: async () => bounty() });
  for (let i = 0; i < 3; i++) await (i % 2 ? one : two).create({ kind: 'support', subject: `Question ${i}`, body: `Diagnostic details ${i}` }, viewer());
  assert.equal(one.list(viewer()).tickets.length, 3);
  assert.equal(two.list(viewer()).tickets.length, 3);
  await assert.rejects(two.create({ kind: 'support', subject: 'Fourth', body: 'This rate limit spans connections.' }, viewer()));
});
