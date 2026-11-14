import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { KeyPairSigner } from 'near-api-js';
import type { AuthChallenge, CommunitySession, TicketDetail } from '@gitsettle/community/types';
import type { PublicConfig } from '@gitsettle/shared/types';
import { assertTestnet, loadEnvironment, readWallets, testnetProvider, type DevelopmentWallet } from './support.js';

const EVIDENCE_FILE = 'docs/COMMUNITY_E2E.json';
let stage = 'configuration';
class SmokeFailure extends Error {}
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new SmokeFailure(message); }

/** Minimal in-memory cookie jar. No cookie/signature is ever persisted or logged. */
class SupportBrowser {
  private readonly cookies = new Map<string, string>();
  constructor(readonly origin: string) {}
  cookieHeader() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '); }
  async request<T>(path: string, method = 'GET', body?: unknown, override?: { cookie?: string; origin?: string }): Promise<{ status: number; body: T }> {
    ensure(path.startsWith('/api/'), 'The smoke test only calls this instance’s API.');
    const response = await fetch(`${this.origin}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', ...(method !== 'GET' ? { Origin: override?.origin ?? this.origin, 'Content-Type': 'application/json' } : {}),
        Cookie: override?.cookie ?? this.cookieHeader() },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const entry of response.headers.getSetCookie()) {
      const [pair, ...attributes] = entry.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const secure = this.origin.startsWith('https:');
      ensure(/^(?:__Host-)?gitsettle_(?:session|challenge)$/.test(name), 'The app returned an unexpected cookie.');
      ensure(attributes.some(item => item.trim().toLowerCase() === 'httponly')
        && attributes.some(item => item.trim().toLowerCase() === 'samesite=lax')
        && (!secure || attributes.some(item => item.trim().toLowerCase() === 'secure')), 'Authentication cookie protections were missing.');
      if (!value || attributes.some(item => item.trim().toLowerCase() === 'max-age=0')) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    ensure(response.headers.get('cache-control')?.includes('no-store'), 'A private response was not marked no-store.');
    const result = await response.json() as T;
    return { status: response.status, body: result };
  }
  async logout() {
    const previousCookies = this.cookieHeader();
    const response = await this.request<{ session: null }>('/api/auth/session', 'DELETE');
    ensure(response.status === 200 && response.body.session === null, 'The server did not confirm logout.');
    // Removing a browser cookie alone does not prove server revocation. Re-send
    // the old token in memory and require that its server-side session is gone.
    const stale = await this.request('/api/tickets', 'GET', undefined, { cookie: previousCookies });
    ensure(stale.status === 401, 'The logged-out session token remained valid on the server.');
    this.cookies.clear();
  }
}

async function signIn(browser: SupportBrowser, wallet: DevelopmentWallet): Promise<CommunitySession> {
  const issued = await browser.request<{ challenge: AuthChallenge }>('/api/auth/challenge', 'POST', { accountId: wallet.accountId });
  ensure(issued.status === 200, 'The server could not issue a wallet challenge.');
  const { challenge } = issued.body;
  ensure(challenge.recipient === new URL(browser.origin).host && challenge.callbackUrl === `${browser.origin}/support`, 'The signing challenge belongs to another domain.');
  ensure(challenge.state === challenge.challengeId && challenge.message.includes(wallet.accountId), 'The challenge did not bind the expected account and state.');
  const expires = Date.parse(challenge.expiresAt);
  ensure(expires > Date.now() && expires <= Date.now() + 301_000, 'The challenge has an invalid five-minute expiry.');
  const nonce = Buffer.from(challenge.nonce, 'base64');
  ensure(nonce.length === 32, 'The challenge nonce is not 32 bytes.');
  const signer = KeyPairSigner.fromSecretKey(wallet.privateKey);
  ensure((await signer.getPublicKey()).toString() === wallet.publicKey, 'The development key does not match its public metadata.');
  const signed = await signer.signNep413Message(wallet.accountId, { message: challenge.message, nonce, recipient: challenge.recipient, callbackUrl: challenge.callbackUrl });
  const proof = { challengeId: challenge.challengeId, accountId: signed.accountId, publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString('base64') };
  const originalBrowserCookie = browser.cookieHeader();
  const established = await browser.request<{ session: CommunitySession }>('/api/auth/session', 'POST', proof);
  ensure(established.status === 200 && established.body.session?.accountId === wallet.accountId, 'The server did not authenticate the expected wallet.');
  const replay = await browser.request('/api/auth/session', 'POST', proof, { cookie: originalBrowserCookie });
  ensure(replay.status === 401, 'The server accepted a replayed nonce challenge.');
  return established.body.session;
}

function help() {
  console.log(`GitSettle support API smoke test (no NEAR transactions).

SUPPORT_BASE_URL=http://127.0.0.1:3000 npx tsx scripts/verify-support.ts --run

Start the current web build first, with APP_ORIGIN equal to SUPPORT_BASE_URL,
DEMO_MODE=false, and the existing deployed NEAR_CONTRACT_ID. The script reads
ignored .secrets/testnet-wallets.json, signs NEP-413 messages locally in memory,
and verifies the contributor and verifier keys against finalized testnet state.
It creates ONE support ticket as the contributor, adds a reply, verifies another
wallet cannot access it, closes it, and logs both sessions out. It also checks
nonce replay, anonymous access, account spoofing, and cross-origin rejection.

Only public IDs, timestamps, and check results are written to ${EVIDENCE_FILE}.
Cookies, signatures, keys, and message bodies are never saved or printed.
Each --run creates a new test conversation and counts toward normal rate limits.
--help reads no keys and performs no network calls.`);
}

/** Exercises the deployed HTTP boundary, not an injected provider or mock authentication. */
export async function verifySupport(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { help(); return; }
  ensure(args.length === 1 && args[0] === '--run', 'Choose --run or --help.');
  loadEnvironment();
  if (existsSync('.env.testnet')) process.loadEnvFile('.env.testnet');
  const origin = process.env.SUPPORT_BASE_URL || 'http://127.0.0.1:3000';
  const parsed = new URL(origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  ensure(parsed.origin === origin && !parsed.username && !parsed.password
    && (parsed.protocol === 'https:' || (loopback && parsed.protocol === 'http:')), 'SUPPORT_BASE_URL must be an exact HTTPS origin or HTTP loopback origin.');
  const wallets = readWallets();
  ensure(wallets.network === 'testnet' && [wallets.contract, wallets.contributor, wallets.verifier].every(wallet => wallet.accountId.endsWith('.testnet')), 'Use only the existing named testnet development wallets.');
  ensure(wallets.contributor.accountId !== wallets.verifier.accountId, 'The privacy check requires two distinct wallets.');

  stage = 'testnet identity preflight';
  const provider = testnetProvider();
  await assertTestnet(provider);
  const keyBlocks: Record<string, number> = {};
  for (const [role, wallet] of [['contributor', wallets.contributor], ['verifier', wallets.verifier]] as const) {
    const key = await provider.viewAccessKey({ accountId: wallet.accountId, publicKey: wallet.publicKey, finalityQuery: { finality: 'final' } });
    ensure(key.permission === 'FullAccess', 'A development signing key is not active with FullAccess permission.');
    keyBlocks[role] = key.block_height;
  }
  const publicResponse = await fetch(`${origin}/api/config`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  ensure(publicResponse.ok, 'The local web configuration is not ready.');
  const config = await publicResponse.json() as PublicConfig;
  ensure(config.mode === 'testnet' && config.network === 'testnet' && config.contractId === wallets.contract.accountId, 'The web app is not using the expected live testnet deployment.');

  const contributor = new SupportBrowser(origin);
  const outsider = new SupportBrowser(origin);
  const anonymous = new SupportBrowser(origin);
  let ticketId: string | null = null;
  let resolved = false;
  try {
    stage = 'wallet message authentication';
    const contributorSession = await signIn(contributor, wallets.contributor);
    const outsiderSession = await signIn(outsider, wallets.verifier);
    ensure(!contributorSession.isAdmin && !outsiderSession.isAdmin, 'Use non-admin development wallets to prove creator-only ticket permissions.');

    stage = 'anonymous and origin checks';
    const missing = await anonymous.request('/api/tickets');
    ensure(missing.status === 401, 'Anonymous requests could read private tickets.');
    const crossOrigin = await contributor.request('/api/tickets', 'POST', {}, { origin: 'https://unrelated.example' });
    ensure(crossOrigin.status === 403, 'A cross-origin support mutation was accepted.');

    stage = 'create support ticket';
    const runId = randomUUID();
    const created = await contributor.request<TicketDetail>('/api/tickets', 'POST', {
      kind: 'support', subject: `Integration check ${new Date().toISOString()}`,
      body: `Automated GitSettle support verification. This test checks private message routing. Run ${runId}.`,
      creatorAccount: wallets.verifier.accountId, accountId: wallets.verifier.accountId, isAdmin: true,
    });
    ensure(created.status === 201 && created.body.ticket?.id, 'The support test conversation was not created.');
    ticketId = created.body.ticket.id;
    ensure(created.body.ticket.creatorAccount === wallets.contributor.accountId && created.body.ticket.posterAccount === null
      && created.body.ticket.status === 'open' && !created.body.ticket.permissions.canReview, 'Ticket creation did not use the authenticated non-admin identity.');

    stage = 'cross-account privacy checks';
    const forbiddenRead = await outsider.request(`/api/tickets/${ticketId}`);
    ensure(forbiddenRead.status === 404, 'An unrelated wallet could read the test conversation.');
    const forbiddenReply = await outsider.request(`/api/tickets/${ticketId}/messages`, 'POST', { body: `Unauthorized test reply ${runId}` });
    ensure(forbiddenReply.status === 404, 'An unrelated wallet could reply to the test conversation.');
    const forbiddenResolve = await outsider.request(`/api/tickets/${ticketId}`, 'PATCH', { status: 'resolved' });
    ensure(forbiddenResolve.status === 404, 'An unrelated wallet could close the test conversation.');
    const outsiderList = await outsider.request<{ tickets: { id: string }[] }>('/api/tickets');
    ensure(outsiderList.status === 200 && !outsiderList.body.tickets.some(ticket => ticket.id === ticketId), 'Private tickets leaked into another wallet’s list.');

    stage = 'reply and resolve';
    const replied = await contributor.request<TicketDetail>(`/api/tickets/${ticketId}/messages`, 'POST', { body: `Confirmed: the authorized contributor can add a follow-up. Run ${runId}.`, authorAccount: wallets.verifier.accountId });
    ensure(replied.status === 201 && replied.body.messages.length === 2
      && replied.body.messages.every(message => message.authorAccount === wallets.contributor.accountId), 'A reply did not preserve session-derived authorship.');
    const closed = await contributor.request<TicketDetail>(`/api/tickets/${ticketId}`, 'PATCH', { status: 'resolved' });
    ensure(closed.status === 200 && closed.body.ticket.status === 'resolved' && !closed.body.ticket.permissions.canReply, 'The creator could not resolve the test conversation.');
    resolved = true;
    const closedReply = await contributor.request(`/api/tickets/${ticketId}/messages`, 'POST', { body: `Resolved-state test ${runId}` });
    ensure(closedReply.status === 409, 'A resolved conversation accepted a new reply.');

    stage = 'session logout';
    await contributor.logout();
    await outsider.logout();
    ensure((await contributor.request('/api/tickets')).status === 401 && (await outsider.request('/api/tickets')).status === 401, 'A logged-out browser still accessed private tickets.');

    // Explicit allowlist: never spread HTTP responses or the development wallets into evidence.
    const evidence = {
      version: 1, completed_at: new Date().toISOString(), target_origin: origin, network: 'testnet',
      contract_id: config.contractId, creator_account: wallets.contributor.accountId,
      unrelated_account: wallets.verifier.accountId, finalized_key_blocks: keyBlocks,
      ticket_id: ticketId, final_ticket_status: 'resolved', authorized_message_count: 2,
      checks: { nep413_signature: true, finalized_full_access_keys: true, nonce_replay_rejected: true,
        anonymous_rejected: true, cross_origin_rejected: true, session_derived_identity: true,
        unrelated_read_reply_resolve_rejected: true, unrelated_list_isolated: true,
        creator_reply_and_resolve: true, resolved_reply_rejected: true, logout_rejected: true },
      near_transactions_sent: 0,
      limitations: ['No appeal is created; the live payout bounty is already Released.', 'This verifies API and real wallet-key ownership. Interactive wallet popup/redirect UX is tested separately.'],
    };
    mkdirSync('docs', { recursive: true });
    writeFileSync(`${EVIDENCE_FILE}.tmp`, JSON.stringify(evidence, null, 2) + '\n');
    renameSync(`${EVIDENCE_FILE}.tmp`, EVIDENCE_FILE);
    console.log(`Support API proof passed. Conversation ${ticketId} is resolved. Public evidence: ${EVIDENCE_FILE}. No NEAR transactions sent.`);
  } finally {
    // A partial run may leave only its own test thread open. Close it if the response identified it.
    if (ticketId && !resolved) { try { await contributor.request(`/api/tickets/${ticketId}`, 'PATCH', { status: 'resolved' }); } catch { /* No retry of ticket creation after an ambiguous request. */ } }
    await Promise.allSettled([contributor.logout(), outsider.logout()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifySupport().catch(error => {
    // SDK/fetch errors may contain request details; only our fixed validation messages are printed.
    console.error(error instanceof SmokeFailure ? error.message : `Support verification failed during ${stage}. Inspect configuration and retry when the service is ready; no credential details were logged.`);
    process.exitCode = 1;
  });
}
