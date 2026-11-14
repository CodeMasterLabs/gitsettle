import type { Bounty } from '@gitsettle/shared/types';
import type { VerificationDecision } from './types.js';

const API_ORIGIN = 'https://api.github.com';
const MAX_FILES = 3000;
const PAGE_SIZE = 100;
const LOCALE_ROOTS = new Set(['locales', 'locale', 'i18n', 'l10n', 'translations']);
const TRANSLATION_EXTENSION = /\.(?:json|ya?ml|po|pot|arb|ftl|toml|xml|properties|md|mdx|ts|js)$/i;
const CHANGED_FILE_STATUSES = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']);

/** A failed/partial API response is not evidence against the contributor. */
export class GitHubApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  body: string | null;
  user: { login: string };
  base: { repo: { full_name: string } };
  changed_files: number;
}

interface GitHubFile {
  filename: string;
  status: string;
  changes: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only canonical github.com URLs are accepted; token-bearing fetches use our fixed API origin. */
export function parseGitHubUrl(value: string, kind: 'pull' | 'issues') {
  const match = new RegExp(`^https://github\\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/${kind}/([1-9][0-9]{0,15})$`).exec(value);
  if (!match || [match[1], match[2]].some((part) => part === '.' || part === '..')
    || !Number.isSafeInteger(Number(match[3]))) return null;
  return { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) };
}

/**
 * Evidence must be visible prose, not an example hidden in comments, quotes or
 * code. This is deliberately conservative rather than a general Markdown parser:
 * users can always provide the two documented plain-text evidence lines.
 */
function visibleBodyLines(body: string): string[] {
  const uncommented = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  let fence: { character: string; length: number } | null = null;
  const visible: string[] = [];
  for (const line of uncommented.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t| {0,3}>)/.test(line)) continue;
    visible.push(line.replace(/(`+).*?\1/g, ''));
  }
  return visible;
}

/** Explicit closing references prevent accidental matches to another issue number/repository. */
export function referencesIssue(body: string, repository: string, issueNumber: number): boolean {
  const references = visibleBodyLines(body).join('\n').matchAll(/^ {0,3}(?:[-*+] )?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[ \t]*:?[ \t]*(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*|#[1-9][0-9]*)(?=$|[\s.,;!?)\]])/gim);
  const wanted = repository.toLowerCase();
  for (const [, ref] of references) {
    if (ref.startsWith('#') && Number(ref.slice(1)) === issueNumber) return true;
    if (ref.toLowerCase() === `${wanted}#${issueNumber}`) return true;
    if (ref.toLowerCase() === `https://github.com/${wanted}/issues/${issueNumber}`) return true;
  }
  return false;
}

/** Require the exact account, contract and bounty on a standalone, author-controlled body line. */
export function hasClaimantBinding(body: string, contractId: string, bounty: Pick<Bounty, 'id' | 'claimant'>): boolean {
  if (!bounty.claimant) return false;
  const expected = `GitSettle: ${contractId}/${bounty.id}/${bounty.claimant}`;
  return visibleBodyLines(body).some((line) => line.trim() === expected);
}

/** Match locale path segments, not substrings ("es" must never authorize "es-MX"). */
export function matchesLocalePath(filename: string, targetLocale: string): boolean {
  if (filename.includes('\\') || !TRANSLATION_EXTENSION.test(filename)) return false;
  const segments = filename.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) return false;
  const wanted = targetLocale.toLowerCase();
  return segments.some((part, index) => {
    if (!LOCALE_ROOTS.has(part.toLowerCase())) return false;
    const next = segments[index + 1]?.toLowerCase();
    if (!next) return false;
    // Both locales/es/messages.json and src/i18n/es.json are conventional layouts.
    return (next === wanted && index + 2 < segments.length)
      || (index + 2 === segments.length && next.replace(TRANSLATION_EXTENSION, '') === wanted);
  });
}

function parsePullRequest(value: unknown): GitHubPullRequest {
  if (!isObject(value) || !Number.isSafeInteger(value.number)
    || typeof value.html_url !== 'string' || typeof value.merged !== 'boolean'
    || !(typeof value.merged_at === 'string' || value.merged_at === null)
    || !(typeof value.merge_commit_sha === 'string' || value.merge_commit_sha === null)
    || !(typeof value.body === 'string' || value.body === null)
    || !isObject(value.user) || typeof value.user.login !== 'string'
    || !isObject(value.base) || !isObject(value.base.repo) || typeof value.base.repo.full_name !== 'string'
    || !Number.isSafeInteger(value.changed_files) || (value.changed_files as number) < 0) {
    throw new GitHubApiError('GitHub returned incomplete pull request metadata; verification will retry.');
  }
  return value as unknown as GitHubPullRequest;
}

function parseFiles(value: unknown): GitHubFile[] {
  if (!Array.isArray(value) || value.some((file) => !isObject(file)
    || typeof file.filename !== 'string' || typeof file.status !== 'string'
    || !CHANGED_FILE_STATUSES.has(file.status)
    || !Number.isSafeInteger(file.changes) || (file.changes as number) < 0)) {
    throw new GitHubApiError('GitHub returned incomplete changed-file metadata; verification will retry.');
  }
  return value as GitHubFile[];
}

export interface GitHubClientOptions {
  token?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Deterministic trusted-oracle policy. It verifies metadata, never code or translation quality. */
export class GitHubClient {
  private readonly request: typeof fetch;
  constructor(private readonly options: GitHubClientOptions = {}) {
    this.request = options.fetch ?? fetch;
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(`${API_ORIGIN}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': this.options.apiVersion ?? '2026-03-10',
          'User-Agent': 'GitSettle-verifier (https://github.com/CodeMasterLabs/gitsettle)',
          ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        redirect: 'error',
      });
    } catch {
      // Do not include fetch internals or request headers, which can contain the token.
      throw new GitHubApiError('GitHub could not be reached; verification will retry.');
    }
    if (!response.ok) {
      const retrySeconds = Number(response.headers.get('retry-after'));
      const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
      const retryAfterMs = retrySeconds > 0 ? retrySeconds * 1000
        : resetSeconds > 0 ? Math.max(0, resetSeconds * 1000 - Date.now()) : undefined;
      throw new GitHubApiError(`GitHub returned HTTP ${response.status}; check access/rate limits and retry.`, response.status, retryAfterMs);
    }
    try {
      return await response.json();
    } catch {
      throw new GitHubApiError('GitHub returned invalid JSON; verification will retry.');
    }
  }

  async verify(bounty: Bounty, contractId: string): Promise<VerificationDecision> {
    if (bounty.status !== 'Submitted' || !bounty.pr_url || !bounty.claimant) {
      return { status: 'pending', message: 'Waiting for a claimed bounty with a submitted pull request.' };
    }
    const prRef = parseGitHubUrl(bounty.pr_url, 'pull');
    const issueRef = parseGitHubUrl(bounty.issue_url, 'issues');
    if (!prRef || !issueRef || prRef.repo !== bounty.repo || issueRef.repo !== bounty.repo) {
      return { status: 'invalid', message: 'The issue and pull request must use canonical URLs in the bounty repository.' };
    }
    const pr = parsePullRequest(await this.get(`/repos/${prRef.repo}/pulls/${prRef.number}`));
    if (pr.base.repo.full_name.toLowerCase() !== bounty.repo.toLowerCase()
      || pr.number !== prRef.number || pr.html_url.toLowerCase() !== bounty.pr_url.toLowerCase()) {
      return { status: 'invalid', message: 'The pull request targets a different repository or pull request number.' };
    }
    // A deadline cannot invalidate a timely submission. Even a closed PR may be reopened.
    if (!pr.merged) return { status: 'pending', message: 'Waiting for the pull request to merge. The reward remains in escrow.' };
    if (!pr.merged_at || !Number.isFinite(Date.parse(pr.merged_at)) || !pr.merge_commit_sha) {
      throw new GitHubApiError('GitHub has not returned complete merge evidence; verification will retry.');
    }
    // A PR opened earlier may finish bounty work; a historical merge cannot be
    // retroactively rebound by editing its body after this escrow was funded.
    if (Date.parse(pr.merged_at) < bounty.created_at * 1000) {
      return { status: 'invalid', message: 'The pull request was merged before this bounty was funded. Automatic rewards require a merge after bounty creation.' };
    }
    const body = pr.body ?? '';
    if (!hasClaimantBinding(body, contractId, bounty)) {
      return { status: 'invalid', message: 'Add the exact GitSettle claimant binding line to the pull request body, then resubmit before the deadline.' };
    }
    if (!referencesIssue(body, bounty.repo, issueRef.number)) {
      return { status: 'invalid', message: 'Add a plain closing-keyword reference to the bounty issue on its own PR-body line, for example: Fixes #' + issueRef.number + '.' };
    }
    const issue = await this.get(`/repos/${issueRef.repo}/issues/${issueRef.number}`);
    if (!isObject(issue) || issue.number !== issueRef.number || typeof issue.html_url !== 'string') {
      throw new GitHubApiError('GitHub returned incomplete issue metadata; verification will retry.');
    }
    if ('pull_request' in issue || issue.html_url.toLowerCase() !== bounty.issue_url.toLowerCase()) {
      return { status: 'invalid', message: 'The bounty URL must point to a GitHub issue, not another pull request.' };
    }

    let matchingFiles: string[] = [];
    if (bounty.bounty_type === 'Translation') {
      if (!bounty.target_locale) return { status: 'invalid', message: 'A translation bounty must specify a target locale.' };
      if (pr.changed_files > MAX_FILES) {
        throw new GitHubApiError('This pull request exceeds GitHub\'s 3000-file API limit; automatic translation verification is unavailable.');
      }
      const files: GitHubFile[] = [];
      for (let page = 1; files.length < pr.changed_files; page += 1) {
        if (page > MAX_FILES / PAGE_SIZE) throw new GitHubApiError('Changed-file pagination exceeded its safety bound.');
        const batch = parseFiles(await this.get(`/repos/${prRef.repo}/pulls/${prRef.number}/files?per_page=${PAGE_SIZE}&page=${page}`));
        const expected = Math.min(PAGE_SIZE, pr.changed_files - files.length);
        if (batch.length !== expected) throw new GitHubApiError('GitHub returned a partial changed-file list; verification will retry.');
        files.push(...batch);
      }
      if (new Set(files.map((file) => file.filename)).size !== files.length) {
        throw new GitHubApiError('GitHub returned duplicate changed-file pages; verification will retry.');
      }
      matchingFiles = files.filter((file) => !['removed', 'unchanged'].includes(file.status) && file.changes > 0
        && matchesLocalePath(file.filename, bounty.target_locale!)).map((file) => file.filename);
      if (!matchingFiles.length) {
        return { status: 'invalid', message: `No changed translation file matches locale ${bounty.target_locale} under a supported i18n/locales path.` };
      }
    }
    return {
      status: 'valid',
      message: 'Merged pull request, repository, issue and claimant binding verified'
        + (bounty.bounty_type === 'Translation' ? `; locale ${bounty.target_locale} matched.` : '.'),
      author: pr.user.login,
      merge_sha: pr.merge_commit_sha,
      matching_files: matchingFiles,
    };
  }
}
