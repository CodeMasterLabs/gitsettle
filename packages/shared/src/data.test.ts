import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardData, bountyData, contributorData, invalidateReadModels } from './data.ts';
import { fetchBounties, getBounty } from './near.ts';
import type { Bounty, ContractConfig } from './types.ts';

const directory = mkdtempSync(join(tmpdir(), 'gitsettle-readmodel-'));
const originalFetch = globalThis.fetch;
const saved = { DEMO_MODE: process.env.DEMO_MODE, NEAR_CONTRACT_ID: process.env.NEAR_CONTRACT_ID, NEAR_RPC_URL: process.env.NEAR_RPC_URL, DATABASE_PATH: process.env.DATABASE_PATH };
const config: ContractConfig = { verifier: 'verifier.perf.testnet', storage_reserve: '50000000000000000000000', bounty_count: 9, points_per_merge: 100, leaderboard_limit: 100 };
const bounty = (id: number): Bounty => ({ id, repo: 'CodeMasterLabs/gitsettle', issue_url: `https://github.com/CodeMasterLabs/gitsettle/issues/${id + 1}`,
  poster: 'poster.testnet', claimant: 'contributor.testnet', bounty_type: 'Bug', target_locale: null,
  reward: '50000000000000000000000', deadline: 2_000_000_000, status: id === 8 ? 'Released' : 'Open', pr_url: null,
  created_at: 1_800_000_000, submitted_at: null, settled_at: null, rejection_reason: null });
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

before(() => {
  process.env.DEMO_MODE = 'false'; process.env.NEAR_CONTRACT_ID = 'perf.testnet';
  process.env.NEAR_RPC_URL = 'https://rpc.performance.invalid'; process.env.DATABASE_PATH = join(directory, 'readmodel.sqlite');
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(directory, { recursive: true, force: true });
});

function mockViews(handler: (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>, metadata?: (url: string) => Promise<Response>) {
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/')) return metadata ? metadata(url) : Response.json({ message: 'rate limited' }, { status: 403 });
    assert.ok(init?.signal instanceof AbortSignal, 'view requests have a bounded abort deadline');
    assert.equal(init?.redirect, 'error');
    const request = JSON.parse(init?.body as string) as { id: string; params: { method_name: string; args_base64: string; finality: string } };
    assert.equal(request.params.finality, 'final');
    const value = await handler(request.params.method_name, JSON.parse(Buffer.from(request.params.args_base64, 'base64').toString('utf8')));
    return Response.json({ jsonrpc: '2.0', id: request.id, result: { block_height: 100, block_hash: '11111111111111111111111111111111', logs: [], result: [...Buffer.from(JSON.stringify(value))] } });
  }) as typeof fetch;
}

test('cold board starts config/page together, coalesces readers, and never waits for GitHub descriptions', async () => {
  invalidateReadModels();
  const calls: string[] = [];
  let releaseRpc!: () => void;
  let releaseMetadata!: () => void;
  const rpcGate = new Promise<void>(resolve => { releaseRpc = resolve; });
  const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; });
  let activeMetadata = 0;
  let maximumMetadata = 0;
  mockViews(async method => {
    calls.push(method); await rpcGate;
    return method === 'get_config' ? config : Array.from({ length: 9 }, (_, id) => bounty(id));
  }, async url => {
    activeMetadata++; maximumMetadata = Math.max(maximumMetadata, activeMetadata);
    await metadataGate; activeMetadata--;
    return Response.json({ title: `Real issue ${url.split('/').at(-1)}`, body: 'Actual GitHub description.' });
  });
  const first = boardData(); const second = boardData();
  await immediate();
  assert.deepEqual(calls.sort(), ['get_config', 'list_bounties']);
  releaseRpc();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.bounties.length, 9); assert.equal(two.updatedAt, one.updatedAt);
  assert.equal(one.bounties[8].status, 'Released');
  assert.equal(one.bounties[0].metadataStale, true);
  assert.equal(maximumMetadata, 3);
  releaseMetadata();
  for (let i = 0; i < 10; i++) await immediate();
  assert.equal(activeMetadata, 0);
});

test('a direct detail read does not load the board and uncached authority reads still reach NEAR', async () => {
  invalidateReadModels();
  const calls: string[] = [];
  mockViews((method, args) => { calls.push(method); return method === 'get_config' ? config : bounty(Number(args.id)); });
  assert.equal((await bountyData(8)).bounty?.status, 'Released');
  assert.deepEqual(calls.sort(), ['get_bounty', 'get_config']);
  await bountyData(8);
  assert.equal(calls.length, 2);
  await getBounty(8);
  assert.equal(calls.length, 3, 'authorization/confirmation helper bypasses the display cache');
});

test('contributor profile begins alongside the board and display caches isolate RPC endpoints', async () => {
  invalidateReadModels();
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mockViews(async method => {
    calls.push(method); await gate;
    if (method === 'get_config') return config;
    if (method === 'get_profile') return { account_id: 'contributor.testnet', points: 100, merged_count: 1, total_earned: bounty(8).reward };
    return Array.from({ length: 9 }, (_, id) => bounty(id));
  });
  const pending = contributorData('contributor.testnet');
  await immediate();
  assert.deepEqual(calls.sort(), ['get_config', 'get_profile', 'list_bounties']);
  release(); await pending;
  const originalUrl = process.env.NEAR_RPC_URL;
  process.env.NEAR_RPC_URL = 'https://different-rpc.performance.invalid';
  try { await boardData(); assert.equal(calls.filter(method => method === 'get_config').length, 2); }
  finally { process.env.NEAR_RPC_URL = originalUrl; }
});

test('bounded page concurrency catches missing or duplicate chain rows instead of returning incomplete escrow data', async () => {
  let active = 0; let maximum = 0;
  mockViews(async (_method, args) => {
    active++; maximum = Math.max(maximum, active); await immediate(); active--;
    return Array.from({ length: 100 }, (_, index) => bounty(Number(args.from_index) + index));
  });
  const result = await fetchBounties({ ...config, bounty_count: 501 });
  assert.equal(result.length, 501); assert.equal(result[500].id, 500); assert.equal(maximum, 4);
  mockViews(() => [bounty(0)]);
  await assert.rejects(fetchBounties({ ...config, bounty_count: 2 }), /Incomplete/);
  mockViews(() => [bounty(0), bounty(0)]);
  await assert.rejects(fetchBounties({ ...config, bounty_count: 2 }), /Incomplete/);
});

test('malformed or failed finalized RPC responses never become cached bounty state', async () => {
  invalidateReadModels();
  globalThis.fetch = (async () => Response.json({ error: { name: 'UNAVAILABLE' } })) as typeof fetch;
  await assert.rejects(bountyData(8), /incomplete finalized view/);
  globalThis.fetch = (async () => Response.json({ result: { result: [999], block_height: 100, block_hash: 'known' } })) as typeof fetch;
  await assert.rejects(getBounty(8), /incomplete finalized view/);
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  await assert.rejects(getBounty(8), /temporarily unavailable/);
  mockViews((method, args) => method === 'get_config' ? config : bounty(Number(args.id)));
  assert.equal((await bountyData(8)).bounty?.status, 'Released');
});
