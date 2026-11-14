import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApiError, GitHubClient, hasClaimantBinding, matchesLocalePath, parseGitHubUrl, referencesIssue } from './github.js';
import { testBounty, testIssue, testPullRequest } from './fixtures.js';

function clientFor(pr: unknown = testPullRequest, issue: unknown = testIssue, filePages: unknown[] = [[{ filename: 'locales/es/ui.json', status: 'modified', changes: 2 }]]) {
  const requests: string[] = [];
  const client = new GitHubClient({ fetch: async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/files?')) return Response.json(filePages[Number(new URL(url).searchParams.get('page')) - 1] ?? []);
    if (url.includes('/issues/')) return Response.json(issue);
    return Response.json(pr);
  } });
  return { client, requests };
}

test('merged bug PR verifies repository, issue, binding and merge evidence', async () => {
  const { client, requests } = clientFor();
  const decision = await client.verify(testBounty, 'escrow.testnet');
  assert.equal(decision.status, 'valid');
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.startsWith('https://api.github.com/repos/CodeMasterLabs/gitsettle/')));
  if (decision.status === 'valid') assert.equal(decision.author, 'CodeMasterLabs');
});

test('non-submitted bounties make no GitHub request', async () => {
  const { client, requests } = clientFor();
  assert.equal((await client.verify({ ...testBounty, status: 'Open' }, 'escrow.testnet')).status, 'pending');
  assert.equal(requests.length, 0);
});

test('unmerged PR remains pending after deadline, even without body binding', async () => {
  const { client, requests } = clientFor({ ...testPullRequest, merged: false, merged_at: null, body: null });
  assert.equal((await client.verify({ ...testBounty, deadline: 1 }, 'escrow.testnet')).status, 'pending');
  assert.equal(requests.length, 1);
});

test('a historical merge cannot be rebound to a newly funded bounty', async () => {
  const mergedBefore = new Date((testBounty.created_at - 1) * 1000).toISOString();
  assert.equal((await clientFor({ ...testPullRequest, merged_at: mergedBefore }).client.verify(testBounty, 'escrow.testnet')).status, 'invalid');
  const mergedAfter = new Date((testBounty.created_at + 1) * 1000).toISOString();
  assert.equal((await clientFor({ ...testPullRequest, created_at: '2020-01-01T00:00:00Z', merged_at: mergedAfter }).client.verify(testBounty, 'escrow.testnet')).status, 'valid');
});

test('wrong repository, PR identity, issue reference and claimant cannot authorize payout', async (t) => {
  const cases = [
    { ...testPullRequest, base: { repo: { full_name: 'different/repo' } } },
    { ...testPullRequest, number: 26 },
    { ...testPullRequest, html_url: 'https://github.com/CodeMasterLabs/gitsettle/pull/26' },
    { ...testPullRequest, body: testPullRequest.body.replace('#12', '#123') },
    { ...testPullRequest, body: testPullRequest.body.replace('#12', 'different/repo#12') },
    { ...testPullRequest, body: testPullRequest.body.replace('contributor.testnet', 'attacker.testnet') },
    { ...testPullRequest, body: testPullRequest.body.replace('/7/', '/8/') },
    { ...testPullRequest, body: testPullRequest.body.replace('escrow.testnet', 'other.testnet') },
  ];
  for (const [index, pr] of cases.entries()) await t.test(`invalid evidence ${index + 1}`, async () => {
    assert.equal((await clientFor(pr).client.verify(testBounty, 'escrow.testnet')).status, 'invalid');
  });
});

test('URL parsing refuses SSRF, credentials, suffixes, redirects and unsafe numbers', () => {
  assert.deepEqual(parseGitHubUrl(testBounty.pr_url!, 'pull'), { repo: 'CodeMasterLabs/gitsettle', number: 25 });
  for (const url of [
    'http://github.com/CodeMasterLabs/gitsettle/pull/25',
    'https://github.com.evil.example/CodeMasterLabs/gitsettle/pull/25',
    'https://github.com@evil.example/CodeMasterLabs/gitsettle/pull/25',
    'https://github.com/CodeMasterLabs/gitsettle/pull/25?token=oops',
    'https://github.com/CodeMasterLabs/gitsettle/pull/25#fragment',
    'https://github.com/CodeMasterLabs/gitsettle/pull/25/',
    'https://github.com/CodeMasterLabs/gitsettle/pull/9007199254740993',
    'https://github.com/CodeMasterLabs/gitsettle/pull/025',
    'https://github.com/CodeMasterLabs/../pull/25',
    'https://github.com/./gitsettle/pull/25',
  ]) assert.equal(parseGitHubUrl(url, 'pull'), null, url);
});

test('bad canonical bounty URLs never cause external fetches', async () => {
  const { client, requests } = clientFor();
  assert.equal((await client.verify({ ...testBounty, pr_url: 'https://evil.example/pull/25' }, 'escrow.testnet')).status, 'invalid');
  assert.equal((await client.verify({ ...testBounty, issue_url: 'https://github.com/other/repo/issues/12' }, 'escrow.testnet')).status, 'invalid');
  assert.equal(requests.length, 0);
});

test('issue matching handles closing keyword syntax without number or repo collisions', () => {
  for (const ref of [
    'Fixes #12', 'CLOSES: #12.', 'Resolved CodeMasterLabs/gitsettle#12',
    'Closes https://github.com/CodeMasterLabs/gitsettle/issues/12', 'Fix #12, fixes #42',
  ]) assert.equal(referencesIssue(ref, 'CodeMasterLabs/gitsettle', 12), true, ref);
  for (const ref of ['Fixes #123', 'Closes #12abc', 'Fixes somebody/gitsettle#12', 'Fixes #012', 'See #12', 'Fixes https://github.com/CodeMasterLabs/gitsettle/issues/123']) {
    assert.equal(referencesIssue(ref, 'CodeMasterLabs/gitsettle', 12), false, ref);
  }
});

test('claimant binding must occupy an exact line', () => {
  assert.equal(hasClaimantBinding(testPullRequest.body, 'escrow.testnet', testBounty), true);
  assert.equal(hasClaimantBinding('> GitSettle: escrow.testnet/7/contributor.testnet', 'escrow.testnet', testBounty), false);
  assert.equal(hasClaimantBinding('GitSettle: escrow.testnet/7/contributor.testnet.attacker', 'escrow.testnet', testBounty), false);
  assert.equal(hasClaimantBinding(testPullRequest.body, 'escrow.testnet', { ...testBounty, claimant: null }), false);
});

test('examples, comments, inline code and blockquotes cannot supply hidden evidence', () => {
  const marker = 'GitSettle: escrow.testnet/7/contributor.testnet';
  for (const wrapper of [
    (text: string) => `<!--\n${text}\n-->`,
    (text: string) => `\x60\x60\x60text\n${text}\n\x60\x60\x60`,
    (text: string) => `~~~\n${text}\n~~~`,
    (text: string) => `> ${text}`,
    (text: string) => `    ${text}`,
    (text: string) => `\x60${text}\x60`,
  ]) {
    assert.equal(referencesIssue(wrapper('Fixes #12'), 'CodeMasterLabs/gitsettle', 12), false);
    assert.equal(hasClaimantBinding(wrapper(marker), 'escrow.testnet', testBounty), false);
  }
  assert.equal(referencesIssue('[unrelated](https://example.com "Fixes #12")', 'CodeMasterLabs/gitsettle', 12), false);
  assert.equal(referencesIssue('```\nexample\n```\nFixes #12', 'CodeMasterLabs/gitsettle', 12), true);
  assert.equal(hasClaimantBinding('~~~\nexample\n~~~\n' + marker, 'escrow.testnet', testBounty), true);
});

test('GitHub issue endpoint must identify a real issue rather than a PR', async () => {
  const { client } = clientFor(testPullRequest, { ...testIssue, pull_request: { url: 'pull' } });
  assert.equal((await client.verify(testBounty, 'escrow.testnet')).status, 'invalid');
});

test('partial or inconsistent merge/issue metadata remains an operational error', async () => {
  for (const pr of [{ merged: true }, { ...testPullRequest, merged_at: null }, { ...testPullRequest, merged_at: 'not-a-date' }, { ...testPullRequest, merge_commit_sha: null }]) {
    await assert.rejects(clientFor(pr).client.verify(testBounty, 'escrow.testnet'), GitHubApiError);
  }
  await assert.rejects(clientFor(testPullRequest, {}).client.verify(testBounty, 'escrow.testnet'), GitHubApiError);
});

test('translation checks exact locale paths with real changes', async () => {
  const { client } = clientFor();
  const decision = await client.verify({ ...testBounty, bounty_type: 'Translation', target_locale: 'es' }, 'escrow.testnet');
  assert.equal(decision.status, 'valid');
  if (decision.status === 'valid') assert.deepEqual(decision.matching_files, ['locales/es/ui.json']);
});

test('locale path policy supports conventional directory and filename layouts', () => {
  for (const path of ['locales/es/ui.json', 'src/i18n/es.json', 'public/locales/es/common.yaml', 'translations/es/messages.po', 'l10n/es/ui.ftl']) {
    assert.equal(matchesLocalePath(path, 'es'), true, path);
  }
  for (const path of ['locales/es-MX/ui.json', 'locales/est/ui.json', 'src/es/ui.json', 'i18n/en/es.json', '../locales/es/ui.json', 'locales/es/../../secret.json', 'locales\\es\\ui.json', 'locales//es/ui.json', 'locales/es/logo.png', 'notlocales/es/ui.json']) {
    assert.equal(matchesLocalePath(path, 'es'), false, path);
  }
});

test('removed, unchanged, other-locale and absent files cannot pass translation verification', async (t) => {
  for (const file of [
    { filename: 'locales/es/ui.json', status: 'removed', changes: 10 },
    { filename: 'locales/es/ui.json', status: 'modified', changes: 0 },
    { filename: 'locales/es/ui.json', status: 'unchanged', changes: 10 },
    { filename: 'locales/en/ui.json', status: 'modified', changes: 10 },
  ]) await t.test(file.status + file.changes + file.filename, async () => {
    const { client } = clientFor(testPullRequest, testIssue, [[file]]);
    assert.equal((await client.verify({ ...testBounty, bounty_type: 'Translation', target_locale: 'es' }, 'escrow.testnet')).status, 'invalid');
  });
  const empty = clientFor({ ...testPullRequest, changed_files: 0 });
  assert.equal((await empty.client.verify({ ...testBounty, bounty_type: 'Translation', target_locale: 'es' }, 'escrow.testnet')).status, 'invalid');
});

test('matching files on page two are found after complete pagination', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `src/file-${i}.ts`, status: 'modified', changes: 1 }));
  const { client, requests } = clientFor({ ...testPullRequest, changed_files: 101 }, testIssue, [page1, [{ filename: 'locales/ja/ui.json', status: 'added', changes: 4 }]]);
  assert.equal((await client.verify({ ...testBounty, bounty_type: 'Translation', target_locale: 'ja' }, 'escrow.testnet')).status, 'valid');
  assert.ok(requests.some((url) => url.endsWith('page=2')));
});

test('partial, duplicate and over-cap file lists fail closed without rejection', async () => {
  const translation = { ...testBounty, bounty_type: 'Translation' as const, target_locale: 'es' };
  await assert.rejects(clientFor({ ...testPullRequest, changed_files: 2 }).client.verify(translation, 'escrow.testnet'), /partial changed-file/);
  await assert.rejects(clientFor({ ...testPullRequest, changed_files: 3001 }).client.verify(translation, 'escrow.testnet'), /3000-file/);
  const duplicate = [{ filename: 'locales/es/ui.json', status: 'modified', changes: 1 }, { filename: 'locales/es/ui.json', status: 'modified', changes: 1 }];
  await assert.rejects(clientFor({ ...testPullRequest, changed_files: 2 }, testIssue, [duplicate]).client.verify(translation, 'escrow.testnet'), /duplicate/);
  await assert.rejects(clientFor(testPullRequest, testIssue, [[{ filename: 'locales/es/ui.json' }]]).client.verify(translation, 'escrow.testnet'), /incomplete changed-file/);
  await assert.rejects(clientFor(testPullRequest, testIssue, [[{ filename: 'locales/es/ui.json', status: 'unknown', changes: 5 }]]).client.verify(translation, 'escrow.testnet'), /incomplete changed-file/);
});

test('timeouts, invalid JSON, auth errors and rate limits remain retryable', async () => {
  const network = new GitHubClient({ fetch: async () => { throw new Error('Request failed with token=do-not-log'); } });
  await assert.rejects(network.verify(testBounty, 'escrow.testnet'), (error: Error) => error instanceof GitHubApiError && !error.message.includes('token='));
  const malformed = new GitHubClient({ fetch: async () => new Response('invalid json', { status: 200 }) });
  await assert.rejects(malformed.verify(testBounty, 'escrow.testnet'), /invalid JSON/);
  for (const status of [403, 404, 429, 500]) {
    const denied = new GitHubClient({ fetch: async () => new Response('', { status, headers: { 'retry-after': '120' } }) });
    await assert.rejects(denied.verify(testBounty, 'escrow.testnet'), (error: Error) => error instanceof GitHubApiError && error.status === status && error.retryAfterMs === 120000);
  }
});

test('GitHub requests pin API headers, forbid redirects and keep token on the fixed origin', async () => {
  let count = 0;
  const client = new GitHubClient({ token: 'test-token-not-a-secret', fetch: async (input, init) => {
    assert.equal(new URL(String(input)).origin, 'https://api.github.com');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-GitHub-Api-Version'), '2026-03-10');
    assert.equal(headers.get('Authorization'), 'Bearer test-token-not-a-secret');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    return Response.json(count++ === 0 ? testPullRequest : testIssue);
  } });
  assert.equal((await client.verify(testBounty, 'escrow.testnet')).status, 'valid');
});
