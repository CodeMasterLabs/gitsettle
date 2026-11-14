import { createHash } from 'node:crypto';
import { CommunityError, requireSession } from '@gitsettle/community/http';
import { boardData } from '@gitsettle/shared/data';
import { getBounty } from '@gitsettle/shared/near';
import type { Bounty } from '@gitsettle/shared/types';
import { deterministicTriage, inspectGitHubIssue, parseCandidate, parseChat } from './core.ts';
import { ExpiringCache, PreflightLimiter, requestRateKey, SqliteAiQuota, type AiQuota } from './limits.ts';
import { LlmClient } from './llm.ts';
import { TriageError, type IssueEvidence, type TriageCandidate, type TriageResult } from './types.ts';

interface CachedTriage { result: TriageResult; evidence: IssueEvidence }
export interface TriageDependencies {
  bounties(): Promise<Bounty[]>;
  issue(candidate: TriageCandidate): Promise<IssueEvidence>;
  session(request: Request): Promise<{ accountId: string }>;
  bounty(id: number): Promise<Bounty | null>;
  llm: LlmClient;
  quota(): AiQuota;
  limiter: PreflightLimiter;
  cache: ExpiringCache<CachedTriage>;
  namespace: string;
  trustProxy: boolean;
}

const limiter = new PreflightLimiter();
const cache = new ExpiringCache<CachedTriage>();
let quota: SqliteAiQuota | undefined;
function dependencies(): TriageDependencies {
  const namespace = JSON.stringify(['testnet', process.env.NEAR_CONTRACT_ID || 'demo', process.env.APP_ORIGIN || '']);
  return {
    bounties: async () => (await boardData()).bounties, issue: inspectGitHubIssue,
    session: requireSession, bounty: getBounty, llm: new LlmClient(),
    quota: () => quota ??= new SqliteAiQuota(process.env.DATABASE_PATH || 'data/gitsettle.sqlite', namespace),
    limiter, cache, namespace, trustProxy: process.env.TRUST_PROXY_HEADERS === 'true',
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } });
}
function failure(error: unknown): Response {
  const safe = error instanceof TriageError || error instanceof CommunityError ? error : new TriageError(503, 'triage_unavailable', 'This check is temporarily unavailable. Try again shortly.');
  const response = json({ error: { code: safe.code, message: safe.message } }, safe.status);
  if (safe.status === 429) response.headers.set('Retry-After', String(safe instanceof TriageError ? safe.retryAfter || 60 : 60));
  return response;
}

/** Bound bytes while streaming; untrusted Content-Length alone cannot enforce the limit. */
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new TriageError(415, 'json_required', 'Send this request as application/json.');
  const reader = request.body?.getReader();
  if (!reader) throw new TriageError(400, 'invalid_json', 'Send a JSON request body.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 40_000) { await reader.cancel(); throw new TriageError(413, 'request_too_large', 'The request body is too large.'); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof TriageError) throw error;
    throw new TriageError(400, 'invalid_json', 'The request body must be valid JSON.');
  } finally { reader.releaseLock(); }
}

/** Deterministic preflight is public; optional billable advice requires wallet-session identity. */
export async function handleTriage(request: Request, injected?: TriageDependencies): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new TriageError(405, 'method_not_allowed', 'Use POST for a bounty preflight check.');
    const services = injected ?? dependencies();
    services.limiter.consume(requestRateKey(request, services.trustProxy));
    const candidate = parseCandidate(await readJson(request));
    const key = createHash('sha256').update(JSON.stringify({ namespace: services.namespace, ...candidate, useAi: false, repo: candidate.repo.toLowerCase(), issue_url: candidate.issue_url.toLowerCase() })).digest('hex');
    let cached = services.cache.get(key);
    if (!cached) {
      const [bounties, evidence] = await Promise.all([services.bounties(), services.issue(candidate)]);
      cached = { result: deterministicTriage(candidate, bounties, evidence), evidence };
      services.cache.set(key, cached);
    }
    const result = cached.result;
    result.aiConfigured = services.llm.publicConfig().configured;
    if (candidate.useAi) {
      const session = await services.session(request);
      if (result.aiConfigured) {
        services.quota().consume(session.accountId);
        try { result.ai = await services.llm.review(candidate, result, cached.evidence); }
        catch (error) {
          const safe = error instanceof TriageError ? error : new TriageError(502, 'ai_unavailable', 'AI advice is unavailable; the deterministic check is still shown.');
          result.aiError = { code: safe.code, message: safe.message };
        }
      } else result.aiError = { code: 'ai_not_configured', message: 'AI is not configured. The deterministic check is complete.' };
    }
    return json(result);
  } catch (error) { return failure(error); }
}

/** AI chat has no tools, no wallet keys and no authority over escrow or support decisions. */
export async function handleAiChat(request: Request, injected?: TriageDependencies): Promise<Response> {
  try {
    const services = injected ?? dependencies();
    const config = services.llm.publicConfig();
    if (request.method === 'GET') return json(config);
    if (request.method !== 'POST') throw new TriageError(405, 'method_not_allowed', 'Use GET for AI availability or POST for a support question.');
    const input = parseChat(await readJson(request));
    const session = await services.session(request);
    if (!config.configured) throw new TriageError(503, 'ai_not_configured', 'AI is not configured on this instance. Open an ordinary support ticket instead.');
    services.quota().consume(session.accountId);
    let bountyContext: Record<string, unknown> | undefined;
    if (input.bountyId !== undefined) {
      try {
        const bounty = await services.bounty(input.bountyId);
        bountyContext = bounty ? { id: bounty.id, repo: bounty.repo, issue_url: bounty.issue_url, status: bounty.status, bounty_type: bounty.bounty_type, target_locale: bounty.target_locale, deadline: bounty.deadline, source: 'contract view at request time; not a payment authorization' } : { id: input.bountyId, unavailable: true };
      } catch { bountyContext = { id: input.bountyId, unavailable: true }; }
    }
    const reply = await services.llm.chat(input, bountyContext);
    return json({ ...config, reply });
  } catch (error) { return failure(error); }
}
