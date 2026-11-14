import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Account, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';
import { getVerification, recordVerification, saveMetadata } from '@gitsettle/shared/db';
import { BOUNTY_TYPES, type Bounty, type BountyType, type ContractConfig, type Contributor } from '@gitsettle/shared/types';
import { GitHubClient, parseGitHubUrl } from '../services/verifier/src/github.js';
import { NearGateway } from '../services/verifier/src/near.js';
import { VerifierWorker } from '../services/verifier/src/worker.js';
import type { ChainPort, VerificationDecision } from '../services/verifier/src/types.js';
import { assertTestnet, loadEnvironment, readWallets, safeError, testnetProvider, walletFile, type DevelopmentWallets } from './support.js';

const JOURNAL = '.secrets/live-loop.json';
const EVIDENCE = 'docs/LIVE_E2E.json';
const REPOSITORY = 'CodeMasterLabs/gitsettle';
const REWARD = nearToYocto('0.05').toString();

interface SigningIdentity { accountId: string; privateKey: KeyPairString }
interface LoopJournal {
  version: 1;
  network: 'testnet';
  contract_id: string;
  poster_id: string;
  contributor_id: string;
  verifier_id: string;
  issue_url: string;
  pr_url?: string;
  bounty_type: BountyType;
  target_locale: string | null;
  reward: string;
  storage_reserve: string;
  deadline: number;
  started_at: string;
  create_attempted?: boolean;
  bounty_id?: number;
  profile_before?: Contributor;
  balance_before_settlement?: string;
  github_evidence?: Extract<VerificationDecision, { status: 'valid' }>;
  transactions: { create?: string; claim?: string; submit?: string; release?: string };
  completed_at?: string;
}

/** Atomic checkpoints contain public identifiers and progress only, never private keys. */
function saveJournal(journal: LoopJournal) {
  mkdirSync('.secrets', { recursive: true, mode: 0o700 });
  writeFileSync(`${JOURNAL}.tmp`, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${JOURNAL}.tmp`, JOURNAL);
}

function identity(role: 'POSTER' | 'CONTRIBUTOR' | 'VERIFIER', fallback?: SigningIdentity): SigningIdentity {
  const accountId = process.env[`NEAR_${role}_ACCOUNT_ID`];
  const privateKey = process.env[`NEAR_${role}_PRIVATE_KEY`];
  if (accountId || privateKey) {
    if (!accountId || !privateKey) throw new Error(`Set both NEAR_${role}_ACCOUNT_ID and NEAR_${role}_PRIVATE_KEY.`);
    return { accountId, privateKey: privateKey as KeyPairString };
  }
  if (fallback) return fallback;
  throw new Error(`Configure the ${role.toLowerCase()} account/key locally or run npm run wallets first.`);
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function help() {
  console.log(`GitSettle real testnet/GitHub loop (run from repository root).

1. LIVE_ISSUE_URL=https://github.com/${REPOSITORY}/issues/N npx tsx scripts/live-loop.ts --prepare
   Funds a 0.05 NEAR bounty plus the on-chain storage reserve, claims it, and prints
   the exact PR-body marker. Keep the issue open until the demonstration PR merges.
2. Put the printed evidence lines in a real PR body and merge that PR AFTER prepare.
3. LIVE_PR_URL=https://github.com/${REPOSITORY}/pull/N npx tsx scripts/live-loop.ts --settle
   Verifies GitHub evidence, submits the PR, runs the actual payout worker for this
   bounty, and checks the recipient balance, earned points and leaderboard.

Optional LIVE_BOUNTY_TYPE=Translation and LIVE_TARGET_LOCALE=es exercise locale
verification; default type is Bug. Set GITHUB_TOKEN for authenticated API reads.
Keys come from NEAR_POSTER/CONTRIBUTOR/VERIFIER_ACCOUNT_ID and _PRIVATE_KEY pairs
or ignored .secrets/testnet-wallets.json. .env and .env.testnet are loaded locally.
Run one verifier only during this proof so unrelated activity does not affect the
exact balance/profile comparison. Checkpoints: ${JOURNAL}; public proof: ${EVIDENCE}.
--check only reads current checkpoint/on-chain status. --help never reads keys.
No transactions are sent unless --prepare or --settle is explicitly selected.`);
}

/** Two-phase live demonstration with finalized state checks and replay-safe local recovery. */
async function run() {
  const arguments_ = process.argv.slice(2);
  if (!arguments_.length || arguments_.includes('--help')) { help(); return; }
  requireCondition(arguments_.length === 1 && ['--prepare', '--settle', '--check'].includes(arguments_[0]), 'Choose exactly one of --prepare, --settle or --check.');
  const phase = arguments_[0];
  loadEnvironment();
  if (existsSync('.env.testnet')) process.loadEnvFile('.env.testnet');
  const wallets: DevelopmentWallets | undefined = existsSync(walletFile) ? readWallets() : undefined;
  const poster = identity('POSTER', wallets?.contract);
  const contributor = identity('CONTRIBUTOR', wallets?.contributor);
  const verifier = identity('VERIFIER', wallets?.verifier);
  const contractId = process.env.NEAR_CONTRACT_ID || wallets?.contract.accountId;
  requireCondition(typeof contractId === 'string' && contractId.endsWith('.testnet'), 'Configure a named NEAR_CONTRACT_ID on testnet.');
  requireCondition([poster, contributor, verifier].every((account) => account.accountId.endsWith('.testnet')), 'Only named testnet development accounts are supported.');
  requireCondition(poster.accountId !== contributor.accountId, 'Poster and contributor must be separate accounts.');
  process.env.NEAR_CONTRACT_ID = contractId;
  process.env.DEMO_MODE = 'false';

  const provider = testnetProvider();
  await assertTestnet(provider);
  const view = async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> => await provider.callFunction({
    contractId, method, args, blockQuery: { finality: 'final' },
  }) as T;
  const config = await view<ContractConfig>('get_config');
  requireCondition(config.verifier === verifier.accountId, 'Configured verifier does not match the deployed contract.');
  const gateway = new NearGateway({ contractId, rpcUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org', verifierId: verifier.accountId, privateKey: verifier.privateKey });
  await gateway.assertConfiguredVerifier();
  const getBounty = (id: number) => view<Bounty | null>('get_bounty', { id });
  const getProfile = () => view<Contributor>('get_profile', { account_id: contributor.accountId });
  const getBalance = async () => (await provider.viewAccount({ accountId: contributor.accountId, blockQuery: { finality: 'final' } })).amount.toString();
  const posterAccount = new Account(poster.accountId, provider, poster.privateKey);
  const contributorAccount = new Account(contributor.accountId, provider, contributor.privateKey);

  let journal: LoopJournal;
  if (existsSync(JOURNAL)) {
    journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as LoopJournal;
    requireCondition(journal.version === 1 && journal.network === 'testnet' && journal.contract_id === contractId
      && journal.poster_id === poster.accountId && journal.contributor_id === contributor.accountId
      && journal.verifier_id === verifier.accountId, 'Existing live-loop checkpoint belongs to different accounts/deployment; inspect it before proceeding.');
    requireCondition(!process.env.LIVE_ISSUE_URL || process.env.LIVE_ISSUE_URL === journal.issue_url, 'LIVE_ISSUE_URL differs from the existing checkpoint.');
  } else {
    requireCondition(phase === '--prepare', 'Run --prepare first. No live-loop checkpoint exists.');
    const issueUrl = process.env.LIVE_ISSUE_URL ?? '';
    requireCondition(parseGitHubUrl(issueUrl, 'issues')?.repo === REPOSITORY, `LIVE_ISSUE_URL must be a canonical issue URL in ${REPOSITORY}.`);
    const type = (process.env.LIVE_BOUNTY_TYPE ?? 'Bug') as BountyType;
    requireCondition(BOUNTY_TYPES.includes(type), 'LIVE_BOUNTY_TYPE must be a supported bounty type.');
    const locale = type === 'Translation' ? (process.env.LIVE_TARGET_LOCALE ?? 'es').toLowerCase() : null;
    journal = {
      version: 1, network: 'testnet', contract_id: contractId, poster_id: poster.accountId,
      contributor_id: contributor.accountId, verifier_id: verifier.accountId, issue_url: issueUrl,
      bounty_type: type, target_locale: locale, reward: REWARD, storage_reserve: config.storage_reserve,
      deadline: Math.floor(Date.now() / 1000) + 86400, started_at: new Date().toISOString(), transactions: {},
    };
    saveJournal(journal);
  }

  if (phase === '--check') {
    console.log(JSON.stringify({
      contract_id: contractId, bounty: journal.bounty_id === undefined ? null : await getBounty(journal.bounty_id),
      contributor: await getProfile(), transactions: journal.transactions, completed_at: journal.completed_at ?? null,
    }, null, 2));
    return;
  }

  if (phase === '--prepare') {
    if (journal.bounty_id === undefined) {
      // Fixed issue/reward/deadline identify an interrupted creation without relying
      // on a guessed next ID. Ambiguous outcomes never trigger a second deposit.
      const matches = (await gateway.listBounties()).filter((bounty) => bounty.poster === poster.accountId
        && bounty.issue_url === journal.issue_url && bounty.reward === journal.reward
        && bounty.deadline === journal.deadline && bounty.bounty_type === journal.bounty_type
        && bounty.target_locale === journal.target_locale);
      requireCondition(matches.length <= 1, 'Multiple matching bounties exist; inspect the checkpoint instead of creating another escrow.');
      if (matches[0]) journal.bounty_id = matches[0].id;
      else {
        requireCondition(!journal.create_attempted, 'An earlier create may have been broadcast but is not yet visible. Inspect finalized transactions before retrying; this script will not risk a duplicate deposit.');
        const issueNumber = parseGitHubUrl(journal.issue_url, 'issues')!.number;
        const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
        const issueResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`, {
          headers: {
            Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': process.env.GITHUB_API_VERSION ?? '2026-03-10',
            'User-Agent': 'GitSettle-live-loop', ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          }, signal: AbortSignal.timeout(15000), redirect: 'error',
        });
        requireCondition(issueResponse.ok, `GitHub issue lookup returned HTTP ${issueResponse.status}; no bounty was funded.`);
        const issue: unknown = await issueResponse.json();
        requireCondition(typeof issue === 'object' && issue !== null && 'number' in issue
          && issue.number === issueNumber && !('pull_request' in issue), 'LIVE_ISSUE_URL must identify a real GitHub issue; no bounty was funded.');
        journal.create_attempted = true;
        saveJournal(journal);
        const outcome = await posterAccount.callFunctionRaw({
          contractId, methodName: 'create_bounty', args: {
            repo: REPOSITORY, issue_url: journal.issue_url, bounty_type: journal.bounty_type,
            target_locale: journal.target_locale, reward: journal.reward, deadline: journal.deadline,
          }, deposit: BigInt(journal.reward) + BigInt(config.storage_reserve), gas: teraToGas('100'), waitUntil: 'FINAL',
        });
        journal.transactions.create = outcome.transaction?.hash;
        saveJournal(journal);
        const created = (await gateway.listBounties()).filter((bounty) => bounty.poster === poster.accountId
          && bounty.issue_url === journal.issue_url && bounty.reward === journal.reward && bounty.deadline === journal.deadline);
        requireCondition(created.length === 1, 'Create finalized but bounty lookup is not yet consistent. Rerun --prepare to recover it.');
        journal.bounty_id = created[0].id;
      }
      saveJournal(journal);
    }
    let bounty = await getBounty(journal.bounty_id);
    requireCondition(bounty, 'Checkpoint bounty is missing on chain.');
    if (bounty.status === 'Open') {
      const outcome = await contributorAccount.callFunctionRaw({ contractId, methodName: 'claim_bounty', args: { id: bounty.id }, deposit: 0n, gas: teraToGas('100'), waitUntil: 'FINAL' });
      journal.transactions.claim = outcome.transaction?.hash;
      saveJournal(journal);
      bounty = await getBounty(bounty.id);
    }
    requireCondition(bounty?.claimant === contributor.accountId, 'The bounty was claimed by a different account.');
    saveMetadata(bounty.id, 'Live proof: settle a merged contribution', 'A real GitHub issue and pull request used to verify the complete testnet payout loop.');
    const issueNumber = parseGitHubUrl(journal.issue_url, 'issues')!.number;
    console.log(`Bounty #${bounty.id} is ${bounty.status}. Put these plain lines in the PR body, then merge it:\n\nFixes #${issueNumber}\nGitSettle: ${contractId}/${bounty.id}/${contributor.accountId}\n\nAfter the merge, run --settle with LIVE_PR_URL. Reward: 0.05 NEAR; storage reserve: ${config.storage_reserve} yoctoNEAR.`);
    return;
  }

  requireCondition(journal.bounty_id !== undefined, 'Run --prepare until a claimed bounty and marker are reported.');
  const prUrl = process.env.LIVE_PR_URL ?? journal.pr_url ?? '';
  requireCondition(parseGitHubUrl(prUrl, 'pull')?.repo === REPOSITORY, `LIVE_PR_URL must be a canonical PR URL in ${REPOSITORY}.`);
  requireCondition(!journal.pr_url || journal.pr_url === prUrl, 'LIVE_PR_URL differs from the checkpoint submission.');
  journal.pr_url = prUrl;
  saveJournal(journal);
  let bounty = await getBounty(journal.bounty_id);
  requireCondition(bounty?.claimant === contributor.accountId, 'Checkpoint claimant does not match on-chain state.');
  const policy = new GitHubClient({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, apiVersion: process.env.GITHUB_API_VERSION ?? '2026-03-10' });

  if (bounty.status !== 'Released') {
    // Check real GitHub evidence before submitting so a typo cannot lock the proof bounty.
    const decision = await policy.verify({ ...bounty, status: 'Submitted', pr_url: prUrl }, contractId);
    requireCondition(decision.status === 'valid', `GitHub evidence is not ready: ${decision.message}`);
    journal.github_evidence = decision;
    if (!journal.profile_before) journal.profile_before = await getProfile();
    saveJournal(journal);
    if (bounty.status === 'Claimed' || bounty.status === 'Rejected') {
      const outcome = await contributorAccount.callFunctionRaw({ contractId, methodName: 'submit_pr', args: { id: bounty.id, pr_url: prUrl }, deposit: 0n, gas: teraToGas('100'), waitUntil: 'FINAL' });
      journal.transactions.submit = outcome.transaction?.hash;
      saveJournal(journal);
      bounty = await getBounty(bounty.id);
    }
    requireCondition(bounty?.status === 'Submitted' && bounty.pr_url === prUrl, 'The proof must be Submitted before this worker starts. Stop other verifier instances while capturing exact payout evidence.');
    if (!journal.balance_before_settlement) {
      // Submission fees and their refunds have finalized before the balance baseline.
      journal.balance_before_settlement = await getBalance();
      saveJournal(journal);
    }
    const scopedChain: ChainPort = {
      contractId,
      listBounties: async () => { const current = await getBounty(journal.bounty_id!); return current ? [current] : []; },
      getBounty: (id) => gateway.getBounty(id),
      release: async (id) => {
        const result = await gateway.release(id);
        journal.transactions.release = result.txHash;
        saveJournal(journal);
        return result;
      },
      reject: (id, reason) => gateway.reject(id, reason),
    };
    const worker = new VerifierWorker(scopedChain, policy, (record) => { recordVerification(record); }, { rejectInvalid: false });
    await worker.tick();
    bounty = await getBounty(journal.bounty_id);
    requireCondition(bounty?.status === 'Released', `Payout is not finalized as Released. ${getVerification(journal.bounty_id)?.message ?? 'Inspect the verifier/RPC and rerun --settle.'}`);
  }

  requireCondition(journal.profile_before && journal.balance_before_settlement && journal.github_evidence, 'Payout exists but a baseline/evidence checkpoint is missing; do not invent balance or point proof.');
  const profileAfter = await getProfile();
  const balanceAfter = await getBalance();
  const leaderboard = await view<Contributor[]>('get_leaderboard', { from_index: 0, limit: 100 });
  const leader = leaderboard.find((entry) => entry.account_id === contributor.accountId);
  const balanceDelta = BigInt(balanceAfter) - BigInt(journal.balance_before_settlement);
  requireCondition(balanceDelta === BigInt(journal.reward), 'Recipient balance delta does not equal the reward; check other account activity before claiming a successful proof.');
  requireCondition(profileAfter.points - journal.profile_before.points === config.points_per_merge, 'Points did not increase by the configured per-merge award.');
  requireCondition(profileAfter.merged_count - journal.profile_before.merged_count === 1, 'Merged count did not increase by one.');
  requireCondition(BigInt(profileAfter.total_earned) - BigInt(journal.profile_before.total_earned) === BigInt(journal.reward), 'Earned amount did not increase by the exact reward.');
  requireCondition(leader?.points === profileAfter.points && leader.total_earned === profileAfter.total_earned, 'The contributor leaderboard has not reflected final settlement.');
  journal.transactions.release ??= getVerification(journal.bounty_id)?.tx_hash ?? undefined;
  requireCondition(Object.values(journal.transactions).filter(Boolean).length === 4, 'A transaction hash was lost during recovery. Inspect chain receipts and repair the local checkpoint before publishing complete proof.');
  journal.completed_at ??= new Date().toISOString();
  const evidence = {
    network: 'testnet', verified_at: journal.completed_at, contract_id: contractId,
    bounty_id: bounty!.id, issue_url: journal.issue_url, pr_url: journal.pr_url,
    poster_id: poster.accountId, contributor_id: contributor.accountId, verifier_id: verifier.accountId,
    bounty_type: journal.bounty_type, target_locale: journal.target_locale,
    reward_yocto: journal.reward, storage_reserve_yocto: journal.storage_reserve,
    final_status: bounty!.status, github_evidence: journal.github_evidence,
    transactions: journal.transactions, balance_before_settlement: journal.balance_before_settlement,
    balance_after_settlement: balanceAfter, balance_increase_yocto: balanceDelta.toString(),
    profile_before: journal.profile_before, profile_after: profileAfter, leaderboard_entry: leader,
    checks: { merged_github_pr: true, automatic_verifier_release: true, exact_balance_increase: true, exact_points_increase: true, leaderboard_updated: true },
  };
  mkdirSync('docs', { recursive: true });
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
  saveJournal(journal);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Full real GitHub/testnet loop verified. Public evidence saved to ${EVIDENCE}.`);
}

/** A local exclusive lock prevents concurrent invocations from funding duplicate proof bounties. */
export async function main() {
  const mutating = process.argv.includes('--prepare') || process.argv.includes('--settle');
  if (!mutating || process.argv.includes('--help')) { await run(); return; }
  mkdirSync('.secrets', { recursive: true, mode: 0o700 });
  const lock = '.secrets/live-loop.lock';
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  } catch {
    throw new Error('Another live-loop process holds .secrets/live-loop.lock. If it crashed, confirm it has exited before removing the stale lock.');
  }
  try { await run(); } finally { unlinkSync(lock); }
}

// Importing this file for checks never signs or reads local keys.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(safeError(error)); process.exitCode = 1; });
}
