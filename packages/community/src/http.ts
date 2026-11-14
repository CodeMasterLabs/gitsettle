import { CHALLENGE_TTL_MS, SESSION_TTL_MS } from './auth.ts';
import { CommunityError } from './errors.ts';
import { getCommunityServices, type CommunityServices } from './server.ts';
import type { CommunitySession } from './types.ts';

export { CommunityError } from './errors.ts';

export type CommunityResource = 'challenge' | 'session' | 'tickets' | 'ticket' | 'messages';
const BODY_LIMIT = 32_768;
export function cookieNames(origin: string) {
  const prefix = origin.startsWith('https:') ? '__Host-' : '';
  return { session: `${prefix}gitsettle_session`, browser: `${prefix}gitsettle_challenge` };
}
function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  // Duplicate cookie names are ambiguous and must never choose an attacker's value.
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}
function cookie(name: string, value: string, ttl: number, origin: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}${origin.startsWith('https:') ? '; Secure' : ''}`;
}
function json(data: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return Response.json(data, { status, headers });
}
function sameOrigin(request: Request, origin: string): void {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new CommunityError(403, 'origin_mismatch', 'This action must come from the GitSettle site where you signed in.');
  }
}

/** Reusable authenticated identity for private, read-only AI helper endpoints.
 * Mutation requests also receive the same canonical-origin CSRF protection.
 * Request body account fields are deliberately never consulted.
 */
export async function requireSession(request: Request, injected?: CommunityServices): Promise<CommunitySession> {
  const services = injected ?? getCommunityServices();
  if (request.method !== 'GET') sameOrigin(request, services.origin);
  const session = await services.auth.getSession(readCookie(request, cookieNames(services.origin).session));
  if (!session) throw new CommunityError(401, 'sign_in_required', 'Sign a wallet message to use this account’s private tools.');
  return session;
}
/** Bound the actual byte stream too: Content-Length is not trustworthy or always present. */
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new CommunityError(415, 'json_required', 'Send this request as application/json.');
  }
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) throw new CommunityError(413, 'body_too_large', 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new CommunityError(400, 'invalid_json', 'A JSON request body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new CommunityError(413, 'body_too_large', 'This request is too large.'); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof CommunityError) throw error;
    throw new CommunityError(400, 'invalid_json', 'The request body must be valid JSON.');
  } finally { reader.releaseLock(); }
}

/** A single adapter applies origin, session, and response rules to every community endpoint. */
export async function handleCommunityRequest(request: Request, resource: CommunityResource, id?: string, injected?: CommunityServices): Promise<Response> {
  try {
    const { origin, auth, tickets } = injected ?? getCommunityServices();
    const names = cookieNames(origin);
    const token = readCookie(request, names.session);
    const browserToken = readCookie(request, names.browser);
    if (request.method !== 'GET') sameOrigin(request, origin);
    if (resource === 'challenge' && request.method === 'POST') {
      const result = auth.createChallenge(await readJson(request), browserToken);
      return json({ challenge: result.challenge }, 200, [cookie(names.browser, result.browserToken, CHALLENGE_TTL_MS, origin)]);
    }
    if (resource === 'session') {
      if (request.method === 'GET') {
        const session = await auth.getSession(token);
        return json({ session }, 200, !session && token ? [cookie(names.session, '', 0, origin)] : []);
      }
      if (request.method === 'POST') {
        const result = await auth.establishSession(await readJson(request), browserToken, token);
        return json({ session: result.session }, 200, [cookie(names.session, result.token, SESSION_TTL_MS, origin), cookie(names.browser, '', 0, origin)]);
      }
      if (request.method === 'DELETE') {
        auth.logout(token);
        return json({ session: null }, 200, [cookie(names.session, '', 0, origin), cookie(names.browser, '', 0, origin)]);
      }
    }
    const session = await auth.getSession(token);
    if (!session) throw new CommunityError(401, 'sign_in_required', 'Sign a wallet message to open your private support conversations.');
    if (resource === 'tickets') {
      if (request.method === 'GET') return json(tickets.list(session));
      if (request.method === 'POST') return json(await tickets.create(await readJson(request), session), 201);
    }
    if (id && id.length <= 80) {
      if (resource === 'ticket' && request.method === 'GET') return json(tickets.detail(id, session));
      if (resource === 'ticket' && request.method === 'PATCH') return json(tickets.update(id, await readJson(request), session));
      if (resource === 'messages' && request.method === 'POST') return json(tickets.reply(id, await readJson(request), session), 201);
    }
    throw new CommunityError(405, 'method_not_allowed', 'This endpoint does not support that action.');
  } catch (error) {
    // Never log signatures, request bodies, session tokens, or RPC error payloads.
    const safe = error instanceof CommunityError ? error : new CommunityError(503, 'support_unavailable', 'Support is temporarily unavailable. Try again shortly.');
    const response = json({ error: { code: safe.code, message: safe.message } }, safe.status);
    if (safe.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
