import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunityError } from '@gitsettle/community/http';
import type { Bounty } from '@gitsettle/shared/types';
import { handleAiChat, handleTriage, type TriageDependencies } from './http.ts';
import { ExpiringCache, PreflightLimiter } from './limits.ts';
import { LlmClient } from './llm.ts';
import { TriageError } from './types.ts';

const origin = 'https://gitsettle.example';
const candidate = { repo: 'CodeMasterLabs/gitsettle', issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/7', bounty_type: 'Translation', target_locale: 'es' };
const request = (path: string, body?: unknown, method = 'POST') => new Request(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const completion = (value: unknown) => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }] });

function fixture(configured = true) {
  const calls = { bounties: 0, issue: 0, session: 0, provider: 0, quota: [] as string[], bountyIds: [] as number[], payload: null as null | Record<string, unknown> };
  const errors: { session?: Error; quota?: Error; provider?: Error; bounty?: Error } = {};
  const deps: TriageDependencies = {
    bounties: async () => { calls.bounties++; return []; },
    issue: async () => { calls.issue++; return { state: 'open' }; },
    session: async () => { calls.session++; if (errors.session) throw errors.session; return { accountId: 'alice.testnet' }; },
    bounty: async id => { calls.bountyIds.push(id); if (errors.bounty) throw errors.bounty; return { ...candidate, id, status: 'Submitted', deadline: 999, poster: 'not-for-llm.testnet', reward: '999', privateData: 'should never send arbitrary fields' } as unknown as Bounty; },
    llm: new LlmClient(configured ? { LLM_BASE_URL: 'https://provider.example/v1', LLM_API_KEY: 'private-provider-key', LLM_MODEL: 'model' } : {}, async (_url, options) => {
      calls.provider++; if (errors.provider) throw errors.provider;
      const body = JSON.parse(options?.body as string); calls.payload = JSON.parse(body.messages[1].content);
      return completion(body.response_format.json_schema.name === 'gitsettle_support' ? { reply: 'Use the wallet claim action.' } : { summary: 'Clarify the scope.', risks: [], suggestedActions: [] });
    }),
    quota: () => ({ consume(accountId) { if (errors.quota) throw errors.quota; calls.quota.push(accountId); } }),
    limiter: new PreflightLimiter(), cache: new ExpiringCache(), namespace: 'site-a', trustProxy: false,
  };
  return { deps, calls, errors };
}

test('anonymous deterministic preflight uses cache, safe response headers, and no wallet or LLM', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const response = await handleTriage(request('/api/triage', candidate), f.deps);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(await response.json(), { duplicateBountyIds: [], signals: [], recommendation: 'ready', aiConfigured: true });
  }
  assert.equal(f.calls.bounties, 1); assert.equal(f.calls.issue, 1); assert.equal(f.calls.session, 0); assert.equal(f.calls.provider, 0);
  f.deps.namespace = 'site-b'; await handleTriage(request('/api/triage', candidate), f.deps);
  assert.equal(f.calls.issue, 2);
});

test('cached deterministic responses never retain private AI advice', async () => {
  const f = fixture();
  const ai = await handleTriage(request('/api/triage', { ...candidate, useAi: true, accountId: 'attacker.testnet' }), f.deps);
  assert.equal(ai.status, 200); assert.equal((await ai.json()).ai.summary, 'Clarify the scope.');
  const plain = await handleTriage(request('/api/triage', candidate), f.deps);
  assert.equal((await plain.json()).ai, undefined);
  assert.equal(f.calls.issue, 1); assert.equal(f.calls.session, 1); assert.deepEqual(f.calls.quota, ['alice.testnet']);
});

test('both billable paths reject missing wallet sessions and origin failures before provider calls', async () => {
  for (const code of ['sign_in_required', 'origin_mismatch']) {
    const f = fixture(); f.errors.session = new CommunityError(code === 'sign_in_required' ? 401 : 403, code, 'Safe auth error');
    const triage = await handleTriage(request('/api/triage', { ...candidate, useAi: true }), f.deps);
    const chat = await handleAiChat(request('/api/ai/chat', { message: 'Hello' }), f.deps);
    assert.equal(triage.status, code === 'sign_in_required' ? 401 : 403); assert.equal(chat.status, triage.status);
    assert.equal((await chat.json()).error.code, code); assert.equal(f.calls.provider, 0); assert.deepEqual(f.calls.quota, []);
  }
});

test('both billable paths use persistent wallet quota and return retry timing without provider calls', async () => {
  const f = fixture(); f.errors.quota = new TriageError(429, 'ai_daily_quota', 'Try tomorrow.', 123);
  for (const response of [await handleTriage(request('/api/triage', { ...candidate, includeAi: true }), f.deps), await handleAiChat(request('/api/ai/chat', { message: 'Hi' }), f.deps)]) {
    assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '123'); assert.equal((await response.json()).error.code, 'ai_daily_quota');
  }
  assert.equal(f.calls.provider, 0);
});

test('AI provider failure keeps deterministic preflight results and consumes an attempt', async () => {
  const f = fixture(); f.errors.provider = new Error('Raw secret provider payload');
  const response = await handleTriage(request('/api/triage', { ...candidate, useAi: true }), f.deps);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.recommendation, 'ready'); assert.equal(body.aiError.code, 'ai_unavailable'); assert.equal(body.ai, undefined);
  assert.deepEqual(f.calls.quota, ['alice.testnet']); assert.ok(!JSON.stringify(body).includes('Raw secret'));
});

test('unconfigured AI exposes availability, returns honest fallback, and never charges quota', async () => {
  const f = fixture(false);
  const status = await handleAiChat(request('/api/ai/chat', undefined, 'GET'), f.deps);
  assert.deepEqual(await status.json(), { configured: false }); assert.equal(f.calls.session, 0);
  const triage = await handleTriage(request('/api/triage', { ...candidate, useAi: true }), f.deps);
  assert.equal(triage.status, 200); assert.equal((await triage.json()).aiError.code, 'ai_not_configured');
  const chat = await handleAiChat(request('/api/ai/chat', { message: 'Hi' }), f.deps);
  assert.equal(chat.status, 503); assert.equal((await chat.json()).error.code, 'ai_not_configured');
  assert.deepEqual(f.calls.quota, []); assert.equal(f.calls.provider, 0);
});

test('chat returns only reply/model and sends a bounded allowlist of contract context', async () => {
  const f = fixture();
  const response = await handleAiChat(request('/api/ai/chat', { message: 'What happens next?', bountyId: 3, accountId: 'attacker.testnet', apiKey: 'attacker' }), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { configured: true, model: 'model', reply: 'Use the wallet claim action.' });
  assert.deepEqual(f.calls.bountyIds, [3]); assert.deepEqual(f.calls.quota, ['alice.testnet']);
  const context = f.calls.payload?.bountyContext as Record<string, unknown>;
  assert.equal(context.id, 3); assert.equal(context.status, 'Submitted'); assert.equal(context.privateData, undefined); assert.equal(context.poster, undefined); assert.match(context.source as string, /not a payment authorization/);
  const publicConfig = await handleAiChat(request('/api/ai/chat', undefined, 'GET'), f.deps);
  assert.deepEqual(await publicConfig.json(), { configured: true, model: 'model' });
});

test('chat marks unavailable contract context explicitly and provider failure is a safe error', async () => {
  const f = fixture(); f.errors.bounty = new Error('private RPC payload');
  const response = await handleAiChat(request('/api/ai/chat', { message: 'What next?', bountyId: 2 }), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(f.calls.payload?.bountyContext, { id: 2, unavailable: true });
  f.errors.provider = new Error('private-provider-key');
  const failed = await handleAiChat(request('/api/ai/chat', { message: 'Try again' }), f.deps);
  assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes('private-provider-key'));
});

test('unsupported methods, invalid JSON, non-JSON and oversized byte streams receive safe errors', async () => {
  const f = fixture();
  assert.equal((await handleTriage(request('/api/triage', undefined, 'GET'), f.deps)).status, 405);
  assert.equal((await handleAiChat(request('/api/ai/chat', undefined, 'DELETE'), f.deps)).status, 405);
  const invalid = new Request(origin + '/api/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal((await handleTriage(invalid, f.deps)).status, 400);
  const form = new Request(origin + '/api/ai/chat', { method: 'POST', body: 'message=hi' });
  assert.equal((await handleAiChat(form, f.deps)).status, 415);
  const oversized = new Request(origin + '/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }, body: JSON.stringify({ message: '界'.repeat(14_000) }) });
  assert.equal((await handleAiChat(oversized, f.deps)).status, 413);
  assert.equal(f.calls.provider, 0);
});

test('public preflight rate limit applies to cached requests too', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) assert.equal((await handleTriage(request('/api/triage', candidate), f.deps)).status, 200);
  const response = await handleTriage(request('/api/triage', candidate), f.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60'); assert.equal(f.calls.issue, 1);
});

test('unexpected internal failures do not expose request, database or network details', async () => {
  const f = fixture(); f.deps.bounties = async () => { throw new Error('DB password: private'); };
  const response = await handleTriage(request('/api/triage', candidate), f.deps);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'triage_unavailable', message: 'This check is temporarily unavailable. Try again shortly.' } });
});
