import type { Bounty, BountyType } from './types.ts';

/** Canonical identity only; this function never fetches user-supplied URLs. */
export function canonicalGitHubUrl(value: string, kind: 'issues' | 'pull'): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/, '');
    if (!new RegExp(`^/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+/${kind}/[1-9][0-9]*$`).test(path)) return null;
    return `https://github.com${path.toLowerCase()}`;
  } catch { return null; }
}

/** An issue and locale can intentionally have multiple funders; report matches for review. */
export function duplicateBountyIds(
  candidate: { issue_url: string; bounty_type: BountyType; target_locale: string | null },
  bounties: Bounty[], nowSeconds = Math.floor(Date.now() / 1000),
): number[] {
  const url = canonicalGitHubUrl(candidate.issue_url, 'issues');
  if (!url) return [];
  return bounties.filter(bounty => canonicalGitHubUrl(bounty.issue_url, 'issues') === url
    && bounty.bounty_type === candidate.bounty_type
    && (bounty.target_locale || '').toLowerCase() === (candidate.target_locale || '').toLowerCase()
    && !['Released', 'Refunded', 'Refunding'].includes(bounty.status)
    && (['Submitted', 'Releasing'].includes(bounty.status) || bounty.deadline > nowSeconds))
    .map(bounty => bounty.id);
}

/** Automatic payout pauses when another submitted/paid bounty references the same PR. */
export function duplicatePullRequestIds(candidate: Bounty, bounties: Bounty[]): number[] {
  const url = candidate.pr_url && canonicalGitHubUrl(candidate.pr_url, 'pull');
  if (!url) return [];
  return bounties.filter(bounty => bounty.id !== candidate.id && bounty.pr_url
    && canonicalGitHubUrl(bounty.pr_url, 'pull') === url
    && ['Submitted', 'Releasing', 'Released'].includes(bounty.status)).map(bounty => bounty.id);
}
