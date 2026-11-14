import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGitHubUrl, duplicateBountyIds, duplicatePullRequestIds } from './dedupe.ts';
import type { Bounty } from './types.ts';
const bounty = { id: 1, issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/9', pr_url: 'https://github.com/CodeMasterLabs/gitsettle/pull/10', bounty_type: 'Translation', target_locale: 'es', deadline: 200, status: 'Submitted' } as Bounty;
test('duplicate work identity normalizes case but separates locale and completed work', () => {
  assert.deepEqual(duplicateBountyIds({ ...bounty, issue_url: bounty.issue_url.toLowerCase() }, [bounty], 300), [1]);
  assert.deepEqual(duplicateBountyIds({ ...bounty, target_locale: 'bn' }, [bounty], 100), []);
  assert.deepEqual(duplicateBountyIds(bounty, [{ ...bounty, status: 'Released' }], 100), []);
  assert.deepEqual(duplicateBountyIds(bounty, [{ ...bounty, status: 'Open' }], 300), []);
});
test('duplicate PR detection includes earlier payouts and ignores unrelated or refunded work', () => {
  assert.deepEqual(duplicatePullRequestIds(bounty, [bounty, { ...bounty, id: 2, status: 'Released' }]), [2]);
  assert.deepEqual(duplicatePullRequestIds(bounty, [{ ...bounty, id: 2, status: 'Refunded' }]), []);
  assert.equal(canonicalGitHubUrl('https://github.com.evil.example/a/b/pull/1', 'pull'), null);
  assert.equal(canonicalGitHubUrl('https://github.com/a/b/pull/1?redirect=evil', 'pull'), null);
});
