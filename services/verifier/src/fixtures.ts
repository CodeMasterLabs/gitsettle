import type { Bounty } from '@gitsettle/shared/types';

/** Deterministic fixtures are only imported by tests; the live worker always reads NEAR/GitHub. */
export const testBounty: Bounty = {
  id: 7, poster: 'maintainer.testnet', repo: 'CodeMasterLabs/gitsettle',
  issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/12', bounty_type: 'Bug',
  target_locale: null, reward: '1000000000000000000000000', deadline: 1794697200,
  status: 'Submitted', claimant: 'contributor.testnet',
  pr_url: 'https://github.com/CodeMasterLabs/gitsettle/pull/25',
  created_at: 1794690000, submitted_at: 1794691000, settled_at: null, rejection_reason: null,
};

export const testPullRequest = {
  number: 25, html_url: 'https://github.com/CodeMasterLabs/gitsettle/pull/25',
  merged: true, merged_at: new Date((testBounty.created_at + 1200) * 1000).toISOString(), merge_commit_sha: 'a'.repeat(40),
  body: 'Fixes #12\n\nGitSettle: escrow.testnet/7/contributor.testnet',
  user: { login: 'CodeMasterLabs' }, base: { repo: { full_name: 'CodeMasterLabs/gitsettle' } }, changed_files: 1,
};

export const testIssue = { number: 12, html_url: testBounty.issue_url };
