import { fetchBounties, fetchLeaderboard, getConfig, getProfile, publicConfig } from './near.ts';
import { getMetadata, getVerification, rankContributors, saveMetadata } from './db.ts';
import { isExpired, parseNear } from './format.ts';
import { STORAGE_RESERVE, type BoardData, type Bounty, type BountyType, type BountyView, type Contributor } from './types.ts';

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

/** Cache only descriptive GitHub data. Reward/status always come from finalized contract views. */
async function hydrateBounty(bounty: Bounty): Promise<BountyView> {
  let metadata = getMetadata(bounty.id);
  if (!metadata || Date.now() - metadata.updatedAt > 600_000) {
    let title = metadata?.title || `Issue #${bounty.issue_url.split('/').pop()}`;
    let description = metadata?.description || 'Read the linked GitHub issue for acceptance criteria and contribution details.';
    try {
      const issue = new URL(bounty.issue_url).pathname.split('/').pop();
      const response = await fetch(`https://api.github.com/repos/${bounty.repo}/issues/${issue}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'GitSettle/0.1 (CodeMasterLabs/gitsettle)' },
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const body = await response.json() as { title?: unknown; body?: unknown; pull_request?: unknown };
        if (!body.pull_request && typeof body.title === 'string') title = body.title;
        if (!body.pull_request && typeof body.body === 'string') description = body.body;
      }
    } catch { /* GitHub descriptions are optional; chain state remains available during a GitHub outage. */ }
    saveMetadata(bounty.id, title, description);
    metadata = getMetadata(bounty.id)!;
  }
  return { ...bounty, title: metadata.title, description: metadata.description, verification: getVerification(bounty.id), expired: isExpired(bounty) };
}

let boardCache: { key: string; until: number; result: Promise<BoardData> } | undefined;
/** Coalesce page reads for five seconds; live errors expire immediately and remain visible. */
export async function boardData(force = false): Promise<BoardData> {
  const config = publicConfig();
  if (config.mode === 'demo') {
    const bounties = demoBounties();
    return { ...config, config: { verifier: 'verifier.demo.testnet', storage_reserve: STORAGE_RESERVE, bounty_count: bounties.length, points_per_merge: 100, leaderboard_limit: 100 }, bounties, updatedAt: Date.now() };
  }
  const key = `${config.mode}:${config.contractId}`;
  if (!force && boardCache?.key === key && boardCache.until > Date.now()) return boardCache.result;
  const result = (async () => {
    const chainConfig = await getConfig();
    const bounties = await fetchBounties();
    // Avoid an unbounded GitHub fanout as the instance grows.
    const hydrated: BountyView[] = [];
    for (let index = 0; index < bounties.length; index += 5) hydrated.push(...await Promise.all(bounties.slice(index, index + 5).map(hydrateBounty)));
    return { ...config, config: chainConfig, bounties: hydrated, updatedAt: Date.now() };
  })();
  boardCache = { key, until: Date.now() + 5000, result };
  try { return await result; } catch (error) { boardCache = undefined; throw error; }
}

export async function leaderboardData() {
  const config = publicConfig();
  const entries = config.mode === 'demo' ? demoContributors : await fetchLeaderboard();
  return { ...config, ...rankContributors(entries) };
}

export async function contributorData(account: string) {
  const board = await boardData();
  const profile = board.mode === 'demo'
    ? demoContributors.find(row => row.account_id === account) ?? { account_id: account, points: 0, merged_count: 0, total_earned: '0' }
    : await getProfile(account);
  return { ...publicConfig(), profile, bounties: board.bounties.filter(row => row.claimant === account) };
}
