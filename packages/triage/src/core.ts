import { canonicalGitHubUrl, duplicateBountyIds } from '@gitsettle/shared/dedupe';
import { BOUNTY_TYPES, type Bounty } from '@gitsettle/shared/types';
import { TriageError, type ChatInput, type IssueEvidence, type TriageCandidate, type TriageResult, type TriageSignal } from './types.ts';

export { duplicatePullRequestIds } from '@gitsettle/shared/dedupe';

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/** Parse only supported fields. User-provided endpoints, prompts and model names are ignored. */
export function parseCandidate(value: unknown): TriageCandidate {
  if (!object(value) || typeof value.repo !== 'string' || !value.repo || value.repo.length > 140
    || typeof value.issue_url !== 'string' || value.issue_url.length > 200
    || !BOUNTY_TYPES.includes(value.bounty_type as never)
    || (value.target_locale != null && (typeof value.target_locale !== 'string' || value.target_locale.length > 16))
    || (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 8000))
    || (value.useAi !== undefined && typeof value.useAi !== 'boolean')
    || (value.includeAi !== undefined && typeof value.includeAi !== 'boolean')) {
    throw new TriageError(400, 'invalid_triage_input', 'Provide a repository, issue URL, work type, optional locale, and no more than 8,000 characters of context.');
  }
  return { repo: value.repo.trim(), issue_url: value.issue_url.trim(), bounty_type: value.bounty_type as TriageCandidate['bounty_type'],
    target_locale: (value.target_locale as string | undefined)?.trim().toLowerCase() || null,
    text: typeof value.text === 'string' ? value.text : '', useAi: value.useAi === true || value.includeAi === true };
}

export function parseChat(value: unknown): ChatInput {
  if (!object(value)) throw new TriageError(400, 'invalid_chat_input', 'Send a question and optional conversation history.');
  // Accept the original messages-array envelope as a compatibility alias.
  let message = value.message;
  let history = value.history ?? [];
  if (message === undefined && Array.isArray(value.messages)) {
    const last = value.messages.at(-1);
    if (object(last) && last.role === 'user') { message = last.content; history = value.messages.slice(0, -1); }
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 8000 || !Array.isArray(history) || history.length > 9
    || history.some(item => !object(item) || !['user', 'assistant'].includes(item.role as string) || typeof item.content !== 'string' || item.content.length > 8000)
    || history.reduce((length, item) => length + (item as { content: string }).content.length, message.length) > 8000
    || (value.bountyId !== undefined && (!Number.isSafeInteger(value.bountyId) || (value.bountyId as number) < 0))) {
    throw new TriageError(400, 'invalid_chat_input', 'Use a nonempty question, at most 10 messages, and at most 8,000 total characters.');
  }
  // Project the allowed transcript fields: arbitrary nested request properties
  // must not be forwarded to a provider or escape the total text-length bound.
  const transcript = (history as ChatInput['history']).map(item => ({ role: item.role, content: item.content }));
  return { message: message.trim(), history: transcript, ...(value.bountyId === undefined ? {} : { bountyId: value.bountyId as number }) };
}

/** Heuristics flag review candidates; they cannot determine intent or block an escrow. */
export function analyzeSpamText(text: string): TriageSignal[] {
  const signals: TriageSignal[] = [];
  const links = text.match(/https?:\/\/[^\s<>]+/gi) || [];
  const normalizedLinks = links.map(link => link.toLowerCase().replace(/[.,;)]+$/, ''));
  if (links.length > 10) signals.push({ code: 'link_flood', severity: 'warning', message: 'This text contains more than ten links. Keep only links needed to explain the work.' });
  if (normalizedLinks.some(link => normalizedLinks.filter(value => value === link).length >= 4)) {
    signals.push({ code: 'repeated_links', severity: 'warning', message: 'The same link appears at least four times. Review repeated or promotional content.' });
  }
  const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.toLowerCase().replace(/\s+/g, ' ').trim()).filter(line => line.length >= 20);
  if (lines.some(line => lines.filter(value => value === line).length >= 3) || /(\S)\1{39,}/u.test(text)) {
    signals.push({ code: 'repeated_text', severity: 'warning', message: 'Repeated lines or long repeated characters may obscure the acceptance criteria.' });
  }
  if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(text)) signals.push({ code: 'invisible_controls', severity: 'warning', message: 'Invisible or directional characters are present. Review identifiers and links before funding.' });
  return signals;
}

/** Determine duplicates and basic evidence quality without trusting any LLM output. */
export function deterministicTriage(candidate: TriageCandidate, bounties: Bounty[], evidence?: IssueEvidence): TriageResult {
  const signals = analyzeSpamText(candidate.text);
  const canonical = canonicalGitHubUrl(candidate.issue_url, 'issues');
  const repoValid = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(candidate.repo) && !candidate.repo.split('/').some(part => part === '.' || part === '..');
  if (!repoValid) signals.push({ code: 'invalid_repository', severity: 'high', message: 'Use a GitHub repository in owner/name format.' });
  if (!canonical || !canonical.startsWith(`https://github.com/${candidate.repo.toLowerCase()}/issues/`)) {
    signals.push({ code: 'issue_url_noise', severity: 'high', message: 'Use a canonical HTTPS GitHub issue URL in the selected repository, without query parameters or fragments.' });
  }
  if (candidate.bounty_type === 'Translation') {
    const locale = candidate.target_locale || '';
    if (!/^[a-z]{2}/.test(locale) || locale.length > 16 || !locale.split('-').every(part => /^[a-z0-9]{1,8}$/.test(part))) {
      signals.push({ code: 'invalid_locale', severity: 'high', message: 'Translation needs a lowercase locale such as es, bn, ja, or pt-br.' });
    }
  } else if (candidate.target_locale) signals.push({ code: 'unexpected_locale', severity: 'warning', message: 'Only translation bounties should specify a target locale.' });
  const duplicates = duplicateBountyIds(candidate, bounties);
  if (duplicates.length) signals.push({ code: 'duplicate_bounty', severity: 'high', message: `Active bounties already cover this issue, type and locale: ${duplicates.map(id => `#${id}`).join(', ')}. Multiple funders may be intentional; review before posting.` });
  if (evidence?.state === 'unavailable') signals.push({ code: 'github_unavailable', severity: 'warning', message: 'GitHub could not confirm the issue. Retry or inspect the issue manually before funding.' });
  if (evidence?.state === 'closed') signals.push({ code: 'issue_closed', severity: 'warning', message: 'The GitHub issue is already closed. Confirm that new work is still needed.' });
  if (evidence?.isPullRequest) signals.push({ code: 'issue_is_pull_request', severity: 'high', message: 'The linked GitHub number is a pull request. Link the issue describing the requested work.' });
  if (evidence?.body) signals.push(...analyzeSpamText(evidence.body).map(signal => ({ ...signal, code: `issue_${signal.code}` })));
  return { duplicateBountyIds: duplicates, signals, recommendation: duplicates.length ? 'duplicate' : signals.some(signal => signal.severity !== 'info') ? 'review' : 'ready', aiConfigured: false };
}

/** Fetch only a reconstructed GitHub API URL; never follow issue-supplied redirects. */
export async function inspectGitHubIssue(candidate: TriageCandidate, fetcher: typeof fetch = fetch): Promise<IssueEvidence> {
  const canonical = canonicalGitHubUrl(candidate.issue_url, 'issues');
  if (!canonical) return { state: 'unavailable' };
  const url = new URL(canonical);
  const [, owner, repo, , number] = url.pathname.split('/');
  try {
    const response = await fetcher(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'GitSettle/0.1 (CodeMasterLabs/gitsettle)' },
      redirect: 'error', signal: AbortSignal.timeout(4000), cache: 'no-store',
    });
    if (!response.ok) return { state: 'unavailable' };
    const body = JSON.parse(await boundedResponseText(response, 65_536)) as Record<string, unknown>;
    if (!object(body) || !['open', 'closed'].includes(body.state as string) || typeof body.title !== 'string') return { state: 'unavailable' };
    return { state: body.state as 'open' | 'closed', title: body.title.slice(0, 300), body: typeof body.body === 'string' ? body.body.slice(0, 8000) : '', isPullRequest: !!body.pull_request };
  } catch { return { state: 'unavailable' }; }
}

/** Bound provider response streams before JSON parsing. Never include their contents in errors. */
export async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new TriageError(502, 'upstream_invalid', 'The provider returned an unreadable response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new TriageError(502, 'upstream_invalid', 'The provider response exceeded the allowed size.'); }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
