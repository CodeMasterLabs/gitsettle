import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bounty, ContractConfig } from '@gitsettle/shared/types';
import { CliError, DEFAULT_CONTRACT, parseArgs } from './args.ts';
import type { CliPort, TransactionPlan } from './client.ts';
import { execute } from './commands.ts';
import type { Credential } from './credentials.ts';

const now = 1_800_000_000;
const txHash = '11111111111111111111111111111111';
const credential = { accountId: 'alice.testnet', privateKey: 'ed25519:TEST_ONLY_NEVER_USED' } as Credential;
const config: ContractConfig = { verifier: 'verifier.testnet', storage_reserve: '75000000000000000000000', bounty_count: 1, points_per_merge: 100, leaderboard_limit: 100 };
const bounty = (overrides: Partial<Bounty> = {}): Bounty => ({ id: 1, repo: 'CodeMasterLabs/gitsettle', issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/9', bounty_type: 'Bug', target_locale: null, poster: 'poster.testnet', claimant: 'alice.testnet', reward: '1000000000000000000000000', status: 'Open', deadline: now + 100, created_at: now - 100, submitted_at: null, settled_at: null, rejection_reason: null, pr_url: null, ...overrides });
const args = (argv: string[]) => parseArgs(argv, {}, now);
function fixture(initial = bounty()) {
  let current = initial; let loaded = 0; let calls = 0; let network: Error | undefined; let transport: Error | undefined; let returnValue: unknown; let followupFail = false;
  const plans: TransactionPlan[] = [];
  const port: CliPort = {
    assertTestnet: async () => { if (network) throw network; }, getConfig: async () => config,
    listBounties: async () => [current], getBounty: async () => { if (followupFail && calls) throw new Error('private RPC context'); return current; },
    getProfile: async account => ({ account_id: account, points: 0, merged_count: 0, total_earned: '0' }), getLeaderboard: async () => [],
    send: async (plan, key) => {
      calls++; plans.push(plan); assert.equal(key.accountId, credential.accountId); if (transport) throw transport;
      const statuses = { create_bounty: 'Open', claim_bounty: 'Claimed', submit_pr: 'Submitted', release: 'Released', refund: 'Refunded' } as const;
      const status = statuses[plan.method as keyof typeof statuses]; current = { ...current, status, poster: plan.method === 'create_bounty' ? key.accountId : current.poster };
      const value = returnValue ?? (['release', 'refund'].includes(plan.method) ? true : current);
      return { transaction: { hash: txHash, signer_id: key.accountId, receiver_id: DEFAULT_CONTRACT, actions: [{ FunctionCall: { method_name: plan.method, args: Buffer.from(JSON.stringify(plan.args)).toString('base64') } }] }, final_execution_status: 'FINAL', status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString('base64') } };
    },
  };
  return { port, deps: { port, now: () => now, credential: () => { loaded++; return credential; } }, plans,
    loaded: () => loaded, calls: () => calls, networkError: () => { network = new CliError('network_mismatch', 'Not testnet'); }, transportError: () => { transport = new Error('SECRET'); }, setReturn: (value: unknown) => { returnValue = value; }, failFollowup: () => { followupFail = true; } };
}

test('ordinary mutation and explicit dry run never load credentials or sign', async () => {
  for (const flags of [[], ['--dry-run'], ['--yes', '--dry-run']]) {
    const f = fixture(); const result = await execute(args(['claim', '1', ...flags]), f.deps);
    assert.equal(result.status, 'preview'); assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0); assert.equal((result.transaction as TransactionPlan).attachedYocto, '0');
  }
});

test('create preview adds the actual on-chain storage reserve with exact arithmetic', async () => {
  const f = fixture();
  const result = await execute(args(['create', '--issue', bounty().issue_url, '--reward', '0.000000000000000000000001', '--deadline', String(now + 100)]), f.deps);
  const plan = result.transaction as TransactionPlan;
  assert.equal(plan.attachedYocto, '75000000000000000000001'); assert.equal(plan.args.reward, '1'); assert.equal(plan.args.target_locale, null); assert.match(plan.warnings[0], /nonrefundable/); assert.equal(f.loaded(), 0);
});

test('explicitly authorized create, claim, submit, release and refund call the expected method once', async () => {
  const cases: [string[], Bounty, string][] = [
    [['create', '--issue', bounty().issue_url, '--reward', '1', '--deadline', String(now + 100)], bounty({ issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/10' }), 'create_bounty'],
    [['claim', '1'], bounty(), 'claim_bounty'],
    [['submit', '1', '--pr', 'https://github.com/CodeMasterLabs/gitsettle/pull/10'], bounty({ status: 'Claimed' }), 'submit_pr'],
    [['release', '1'], bounty({ status: 'Submitted', poster: 'alice.testnet' }), 'release'],
    [['refund', '1'], bounty({ status: 'Rejected', poster: 'alice.testnet', deadline: now }), 'refund'],
  ];
  for (const [argv, initial, method] of cases) {
    const f = fixture(initial); const result = await execute(args([...argv, '--yes']), f.deps);
    assert.equal(result.status, 'confirmed'); assert.equal(f.calls(), 1); assert.equal(f.plans[0].method, method); assert.equal(f.plans[0].gasTgas, '100'); assert.ok(!JSON.stringify(result).includes(credential.privateKey));
  }
});

test('state/access failures and wrong repositories prevent signing', async () => {
  const cases: [string[], Bounty][] = [
    [['claim', '1'], bounty({ poster: 'alice.testnet' })], [['claim', '1'], bounty({ deadline: now })],
    [['submit', '1', '--pr', 'https://github.com/CodeMasterLabs/gitsettle/pull/10'], bounty({ status: 'Claimed', claimant: 'bob.testnet' })],
    [['submit', '1', '--pr', 'https://github.com/evil/repo/pull/10'], bounty({ status: 'Claimed' })],
    [['release', '1'], bounty({ status: 'Submitted' })], [['release', '1'], bounty({ status: 'Open', poster: 'alice.testnet' })],
    [['refund', '1'], bounty({ status: 'Submitted', deadline: now - 1, poster: 'alice.testnet' })],
    [['refund', '1'], bounty({ status: 'Claimed', deadline: now - 1, poster: 'bob.testnet' })],
  ];
  for (const [argv, initial] of cases) { const f = fixture(initial); await assert.rejects(execute(args([...argv, '--yes']), f.deps), CliError); assert.equal(f.calls(), 0); }
});

test('network mismatch blocks before loading a signing credential', async () => {
  const f = fixture(); f.networkError(); await assert.rejects(execute(args(['claim', '1', '--yes']), f.deps)); assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0);
});

test('failed transfer callback cannot be reported as confirmed', async () => {
  const f = fixture(bounty({ status: 'Submitted', poster: 'alice.testnet' })); f.setReturn(false);
  const result = await execute(args(['release', '1', '--yes']), f.deps);
  assert.equal(result.status, 'failed'); assert.equal(result.txHash, txHash);
});

test('mismatched return evidence preserves the hash as pending instead of declaring the requested action failed', async () => {
  const f = fixture();
  const send = f.port.send;
  f.port.send = async (plan, key) => {
    const outcome = await send(plan, key) as { transaction: { receiver_id: string } };
    outcome.transaction.receiver_id = 'another.testnet';
    return outcome;
  };
  const result = await execute(args(['claim', '1', '--yes']), f.deps);
  assert.equal(result.status, 'pending');
  assert.equal(result.txHash, txHash);
  assert.equal(f.calls(), 1);
});

test('uncertain submission redacts transport errors; failed follow-up keeps the transaction hash', async () => {
  const f = fixture(); f.transportError();
  await assert.rejects(execute(args(['claim', '1', '--yes']), f.deps), (error: unknown) => error instanceof CliError && error.code === 'submission_uncertain' && !error.message.includes('SECRET'));
  const other = fixture(); other.failFollowup(); const result = await execute(args(['claim', '1', '--yes']), other.deps);
  assert.equal(result.status, 'pending'); assert.equal(result.txHash, txHash);
});

test('list/show/profile/leaderboard do not load signing credentials', async () => {
  const f = fixture();
  for (const argv of [['list'], ['show', '1'], ['profile', 'alice.testnet'], ['leaderboard']]) await execute(args(argv), f.deps);
  assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0);
});

const create = ['create', '--issue', bounty().issue_url, '--reward', '1', '--deadline', String(now + 100)];

test('create preview reports canonical duplicates and allows review without reading credentials', async () => {
  const f = fixture(bounty({ issue_url: bounty().issue_url.toLowerCase() }));
  for (const flags of [[], ['--yes', '--dry-run'], ['--allow-duplicate']]) {
    const result = await execute(args([...create, ...flags]), f.deps);
    assert.equal(result.status, 'preview');
    assert.deepEqual((result.transaction as TransactionPlan).duplicateBountyIds, [1]);
    assert.match((result.transaction as TransactionPlan).warnings.join(' '), /--allow-duplicate/);
  }
  assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0);
});

test('active duplicates require a separate explicit allow flag before funding', async () => {
  const f = fixture();
  await assert.rejects(execute(args([...create, '--yes']), f.deps), (error: unknown) => error instanceof CliError && error.code === 'duplicate_bounty');
  assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0);
  const result = await execute(args([...create, '--allow-duplicate', '--yes']), f.deps);
  assert.equal(result.status, 'confirmed'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.plans[0].duplicateBountyIds, [1]);
});

test('duplicate preflight separates types/locales/settled work but retains expired submissions', async () => {
  for (const previous of [bounty({ bounty_type: 'Feature' }), bounty({ status: 'Released' }), bounty({ status: 'Refunded' }), bounty({ deadline: now }), bounty({ bounty_type: 'Translation', target_locale: 'bn' })]) {
    const f = fixture(previous);
    const result = await execute(args(create), f.deps);
    assert.deepEqual((result.transaction as TransactionPlan).duplicateBountyIds, []);
  }
  const f = fixture(bounty({ status: 'Submitted', deadline: now - 10 }));
  assert.deepEqual(((await execute(args(create), f.deps)).transaction as TransactionPlan).duplicateBountyIds, [1]);
  const translation = fixture(bounty({ bounty_type: 'Translation', target_locale: 'ES' }));
  assert.deepEqual(((await execute(args([...create, '--type', 'Translation', '--locale', 'es']), translation.deps)).transaction as TransactionPlan).duplicateBountyIds, [1]);
});

test('a duplicate appearing during signer preparation is checked again before any send', async () => {
  const f = fixture(); let reads = 0;
  f.port.listBounties = async () => ++reads === 1 ? [] : [bounty()];
  await assert.rejects(execute(args([...create, '--yes']), f.deps), (error: unknown) => error instanceof CliError && error.code === 'duplicate_bounty');
  assert.equal(reads, 2); assert.equal(f.loaded(), 1); assert.equal(f.calls(), 0);
});

test('failed or malformed duplicate data prevents funding even with explicit duplicate permission', async () => {
  for (const listing of [async () => { throw new Error('RPC unavailable'); }, async () => [{ id: 1 } as Bounty]]) {
    const f = fixture(); f.port.listBounties = listing;
    await assert.rejects(execute(args([...create, '--yes', '--allow-duplicate']), f.deps));
    assert.equal(f.loaded(), 0); assert.equal(f.calls(), 0);
  }
  const f = fixture(); let reads = 0;
  f.port.listBounties = async () => { if (++reads === 2) throw new Error('RPC failed during recheck'); return []; };
  await assert.rejects(execute(args([...create, '--yes']), f.deps));
  assert.equal(f.calls(), 0);
});
