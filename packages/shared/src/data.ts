import { fetchBounties, fetchLeaderboard, getBounty, getConfig, getProfile, publicConfig, viewContract } from './near.ts';
import { dataNamespace, getVerification, rankContributors } from './db.ts';
import { isExpired, parseNear } from './format.ts';
import { STORAGE_RESERVE, type BoardData, type Bounty, type BountyType, type BountyView, type Contributor } from './types.ts';
import { bountyMetadata } from './metadata.ts';
import { readModelCache } from './read-cache.ts';

/** Local examples are never passed to signing or verification. Live mode never falls back to these. */
export const demoWork: { title: string; description: string; type: BountyType; locale: string | null; reward: string }[] = [
  { title: 'Translate the wallet connection flow into Spanish', description: 'Add Spanish copy for wallet connection, escrow review, and transaction recovery in locales/es. Keep account identifiers and NEAR amounts unchanged. Include a screenshot of the completed flow.', type: 'Translation', locale: 'es', reward: '18' },
  { title: 'Prevent stale balances after a confirmed payout', description: 'Refresh the contributor balance and bounty state after finalized transaction receipts. Cover a slow RPC response and preserve the previous view while refreshing.', type: 'Bug', locale: null, reward: '12' },
  { title: 'Audit deadline and refund authorization', description: 'Review the escrow expiry boundary and verify that pending submissions cannot be refunded. Include a reproducible regression test with any proposed fix.', type: 'Audit', locale: null, reward: '35' },
  { title: 'Bring the contributor guide to Bengali', description: 'Translate the contribution guide and work queue labels under locales/bn. Explain how to reference an issue and add the contributor account marker.', type: 'Translation', locale: 'bn', reward: '20' },
  { title: 'Export the maintainer ledger as CSV', description: 'Add an accessible CSV export of posted bounties, rewards, claimants, and settlement status. Amounts must retain exact decimal precision.', type: 'Feature', locale: null, reward: '24' },
  { title: 'Add Japanese transaction status messages', description: 'Add complete Japanese translations under locales/ja for pending, confirmed, failed, and cancelled wallet transactions.', type: 'Translation', locale: 'ja', reward: '16' },
  { title: 'Document recovery from a GitHub API outage', description: 'Write an operator runbook covering rate limits, retries, verifier logs, and safe restart. Include an example that leaves a timely submitted PR protected.', type: 'Other', locale: null, reward: '8' },
  { title: 'Keep issue filters when returning from a bounty', description: 'Preserve type, locale, reward and status filters during navigation so contributors can compare work without resetting the queue.', type: 'Bug', locale: null, reward: '10' },
];

function demoBounties(): BountyView[] {
  const now = Math.floor(Date.now() / 1000);
  return demoWork.map((work, id) => {
    const status = (['Open', 'Open', 'Claimed', 'Open', 'Submitted', 'Open', 'Released', 'Open'] as const)[id];
    return {
      id, title: work.title, description: work.description, repo: 'CodeMasterLabs/gitsettle',
      issue_url: `https://github.com/CodeMasterLabs/gitsettle/issues/${id + 1}`,
      bounty_type: work.type, target_locale: work.locale, reward: parseNear(work.reward),
      deadline: id === 7 ? now - 86_400 : now + (id + 2) * 86_400, status,
      poster: 'maintainer.demo.testnet', claimant: ['Claimed', 'Submitted', 'Released'].includes(status) ? 'maya.demo.testnet' : null,
      pr_url: ['Submitted', 'Released'].includes(status) ? `https://github.com/CodeMasterLabs/gitsettle/pull/${id + 20}` : null,
      created_at: now - 3 * 86_400, submitted_at: ['Submitted', 'Released'].includes(status) ? now - 86_400 : null,
      settled_at: status === 'Released' ? now - 43_200 : null, rejection_reason: null,
      verification: status === 'Submitted' ? { bounty_id: id, outcome: 'pending', message: 'Waiting for the pull request to merge.', checked_at: now } : null,
      expired: id === 7,
    };
  });
}

export const demoContributors: Contributor[] = [
  { account_id: 'maya.demo.testnet', points: 700, merged_count: 7, total_earned: parseNear('124') },
  { account_id: 'arif.demo.testnet', points: 500, merged_count: 5, total_earned: parseNear('92') },
  { account_id: 'yuki.demo.testnet', points: 400, merged_count: 4, total_earned: parseNear('78') },
  { account_id: 'sam.demo.testnet', points: 300, merged_count: 3, total_earned: parseNear('54') },
];

/** Descriptions refresh independently; money/status always originate in finalized views. */
function hydrateBounty(bounty: Bounty): BountyView {
  return { ...bounty, ...bountyMetadata(bounty, dataNamespace()), verification: getVerification(bounty.id), expired: isExpired(bounty) };
}

const cacheKey = (kind: string) => {
  const config = publicConfig();
  return `${config.mode}:${config.contractId}:${config.rpcUrl}:${kind}`;
};
const displayConfig = (force = false) => readModelCache.get(cacheKey('config'), getConfig, force);

/** Clear presentation snapshots after a confirmed transaction; authority reads are never cached. */
export function invalidateReadModels() { readModelCache.clear(); }

/** Expose bounded snapshot age and server work time without caching HTTP responses. */
export function readModelHeaders(updatedAt: number, startedAt: number): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'Server-Timing': `readmodel;dur=${(performance.now() - startedAt).toFixed(1)}`,
    'X-GitSettle-Read-At': new Date(updatedAt).toISOString(), 'X-GitSettle-Cache-Ttl-Ms': '5000' };
}

/** Five-second finalized snapshots; errors never fall back to stale or illustrative balances. */
export async function boardData(force = false): Promise<BoardData> {
  const config = publicConfig();
  if (config.mode === 'demo') {
    const bounties = demoBounties();
    return { ...config, config: { verifier: 'verifier.demo.testnet', storage_reserve: STORAGE_RESERVE, bounty_count: bounties.length, points_per_merge: 100, leaderboard_limit: 100 }, bounties, updatedAt: Date.now() };
  }
  return readModelCache.get(cacheKey('board'), async () => {
    // These independent finalized reads start together. The old board performed
    // get_config twice and then the first page, creating three sequential waits.
    const [chainConfig, firstPage] = await Promise.all([
      displayConfig(force), viewContract<Bounty[]>('list_bounties', { from_index: 0, limit: 100 }),
    ]);
    const bounties = await fetchBounties(chainConfig, firstPage);
    return { ...config, config: chainConfig, bounties: bounties.map(hydrateBounty), updatedAt: Date.now() };
  }, force);
}

/** A detail page reads only its bounty; it never waits for the complete work queue. */
export async function bountyData(id: number, force = false) {
  const config = publicConfig();
  if (config.mode === 'demo') {
    const { bounties, ...board } = await boardData();
    return { ...board, bounty: bounties.find(row => row.id === id) ?? null };
  }
  return readModelCache.get(cacheKey(`bounty:${id}`), async () => {
    const [chainConfig, bounty] = await Promise.all([displayConfig(force), getBounty(id)]);
    return { ...config, config: chainConfig, bounty: bounty ? hydrateBounty(bounty) : null, updatedAt: Date.now() };
  }, force);
}

export async function leaderboardData(force = false) {
  const config = publicConfig();
  if (config.mode === 'demo') return { ...config, ...rankContributors(demoContributors), updatedAt: Date.now() };
  return readModelCache.get(cacheKey('leaderboard'), async () => ({ ...config, ...rankContributors(await fetchLeaderboard()), updatedAt: Date.now() }), force);
}

export async function contributorData(account: string, force = false) {
  const config = publicConfig();
  return readModelCache.get(cacheKey(`contributor:${account}`), async () => {
    const [board, profile] = await Promise.all([
      boardData(force), config.mode === 'demo'
        ? Promise.resolve(demoContributors.find(row => row.account_id === account) ?? { account_id: account, points: 0, merged_count: 0, total_earned: '0' })
        : getProfile(account),
    ]);
    return { ...config, profile, bounties: board.bounties.filter(row => row.claimant === account), updatedAt: board.updatedAt };
  }, force);
}
