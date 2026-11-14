import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PublicKey, type Provider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { AccessKeyDoesNotExistError, AccountDoesNotExistError } from 'near-api-js/rpc-errors';
import { badInput, boundedText, CommunityError, recordInput } from './errors.ts';
import type { AuthChallenge, CommunitySession } from './types.ts';

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 8 * 60 * 60_000;
/** Namespace-wide bound also covers callers who rotate unverified account IDs. */
export const CHALLENGES_PER_MINUTE = 120;
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');
const validToken = (value: string | undefined): value is string => Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));

export interface AuthOptions {
  db: Database.Database;
  namespace: string;
  origin: string;
  admins: ReadonlySet<string>;
  /** Only this read capability is accepted: authentication never obtains a transaction signer. */
  provider: Pick<Provider, 'viewAccessKey'>;
  now?: () => number;
}
interface ChallengeRow { id: string; account_id: string; payload: string; expires_at: number }
interface SessionRow { account_id: string; public_key: string; expires_at: number }

export function validateAccount(value: unknown): string {
  const account = boundedText(value, 'Account ID', 64);
  if (account.length < 2 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account)) badInput('Enter a valid NEAR account ID.');
  return account;
}

/** NEP-413 proves account ownership; opaque sessions are stored only as SHA-256 hashes. */
export class CommunityAuth {
  private readonly now: () => number;
  constructor(private readonly options: AuthOptions) { this.now = options.now ?? Date.now; }

  createChallenge(input: unknown, existingBrowserToken?: string): { challenge: AuthChallenge; browserToken: string } {
    const accountId = validateAccount(recordInput(input).accountId);
    const { db, namespace, origin } = this.options;
    const now = this.now();
    const expires = now + CHALLENGE_TTL_MS;
    const browserToken = validToken(existingBrowserToken) ? existingBrowserToken : opaqueToken();
    const challengeId = randomUUID();
    const challenge: AuthChallenge = {
      challengeId, state: challengeId,
      message: `Sign in to GitSettle support as ${accountId}.\nDomain: ${origin}\nExpires: ${new Date(expires).toISOString()}\nThis message opens a support session. It does not authorize a transaction or payout.`,
      nonce: randomBytes(32).toString('base64'), recipient: new URL(origin).host,
      callbackUrl: `${origin}/support`, expiresAt: new Date(expires).toISOString(),
    };
    db.transaction(() => {
      // Once expired, neither a nonce nor its rate-limit history is useful:
      // the per-account window is exactly the five-minute challenge lifetime.
      db.prepare('DELETE FROM community_challenges WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM community_sessions WHERE expires_at <= ?').run(now);
      const allRecent = db.prepare('SELECT count(*) AS count FROM community_challenges WHERE namespace=? AND created_at>?')
        .get(namespace, now - 60_000) as { count: number };
      if (allRecent.count >= CHALLENGES_PER_MINUTE) throw new CommunityError(429, 'rate_limited', 'Sign-in is busy. Wait a minute before trying again.');
      const recent = db.prepare('SELECT count(*) AS count FROM community_challenges WHERE namespace=? AND account_id=? AND created_at>?')
        .get(namespace, accountId, now - CHALLENGE_TTL_MS) as { count: number };
      if (recent.count >= 10) throw new CommunityError(429, 'rate_limited', 'Too many sign-in attempts. Try again in five minutes.');
      db.prepare('INSERT INTO community_challenges (id,namespace,browser_hash,account_id,payload,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
        .run(challengeId, namespace, hashSecret(browserToken), accountId, JSON.stringify(challenge), now, expires);
    }).immediate();
    return { challenge, browserToken };
  }

  /** The challenge is consumed atomically before verification: failed signatures cannot be replayed. */
  async establishSession(input: unknown, browserToken?: string, previousToken?: string): Promise<{ session: CommunitySession; token: string }> {
    const value = recordInput(input);
    const challengeId = boundedText(value.challengeId, 'Challenge ID', 80);
    const accountId = validateAccount(value.accountId);
    const publicKey = boundedText(value.publicKey, 'Public key', 128);
    const signature = boundedText(value.signature, 'Signature', 128);
    if (!validToken(browserToken)) throw new CommunityError(401, 'invalid_challenge', 'The sign-in browser challenge is missing. Start sign-in again.');
    try {
      if (!publicKey.startsWith('ed25519:') || PublicKey.fromString(publicKey).toString() !== publicKey) throw new Error('curve');
    } catch { badInput('An Ed25519 public key is required.'); }
    const signatureBytes = Buffer.from(signature, 'base64');
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature) badInput('The wallet signature must be 64 bytes encoded as base64.');
    const { db, namespace } = this.options;
    const row = db.prepare(`UPDATE community_challenges SET consumed_at=?
      WHERE id=? AND namespace=? AND account_id=? AND browser_hash=? AND consumed_at IS NULL AND expires_at>?
      RETURNING id,account_id,payload,expires_at`).get(this.now(), challengeId, namespace, accountId, hashSecret(browserToken), this.now()) as ChallengeRow | undefined;
    if (!row) throw new CommunityError(401, 'invalid_challenge', 'This sign-in challenge expired or was already used. Start sign-in again.');
    const challenge = JSON.parse(row.payload) as AuthChallenge;
    // near-api-js 7.5.3's verifier otherwise defaults to optimistic key state.
    // Its only provider operation is viewAccessKey; the adapter forces finality.
    const finalizedProvider = { viewAccessKey: (args: Parameters<Provider['viewAccessKey']>[0]) => this.finalizedKey(args.accountId, args.publicKey.toString()) } as Provider;
    try {
      await verifyMessage({ signerAccountId: accountId, signerPublicKey: publicKey,
        payload: { message: challenge.message, nonce: Buffer.from(challenge.nonce, 'base64'), recipient: challenge.recipient, callbackUrl: challenge.callbackUrl },
        signature: signatureBytes, provider: finalizedProvider });
    } catch (error) {
      if (error instanceof CommunityError) throw error;
      throw new CommunityError(401, 'invalid_signature', 'The wallet signature did not match this sign-in challenge.');
    }
    if (row.expires_at <= this.now()) throw new CommunityError(401, 'invalid_challenge', 'This sign-in challenge expired. Start sign-in again.');
    const token = opaqueToken();
    const expires = this.now() + SESSION_TTL_MS;
    db.transaction(() => {
      if (validToken(previousToken)) db.prepare('DELETE FROM community_sessions WHERE namespace=? AND token_hash=?').run(namespace, hashSecret(previousToken));
      db.prepare('INSERT INTO community_sessions (token_hash,namespace,account_id,public_key,created_at,expires_at) VALUES (?,?,?,?,?,?)')
        .run(hashSecret(token), namespace, accountId, publicKey, this.now(), expires);
    }).immediate();
    return { session: this.publicSession(accountId, expires), token };
  }

  /** Revoking the signing FullAccess key invalidates the session at the next finalized RPC read. */
  async getSession(token?: string): Promise<CommunitySession | null> {
    if (!validToken(token)) return null;
    const { db, namespace } = this.options;
    const row = db.prepare('SELECT account_id,public_key,expires_at FROM community_sessions WHERE namespace=? AND token_hash=?')
      .get(namespace, hashSecret(token)) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_at <= this.now()) { this.logout(token); return null; }
    try { await this.finalizedKey(row.account_id, row.public_key); }
    catch (error) {
      if (error instanceof CommunityError && error.status === 401) { this.logout(token); return null; }
      throw error;
    }
    // A slow RPC read must not revive a session that expired or was logged out
    // while this request was waiting for finalized key state.
    if (row.expires_at <= this.now()
      || !db.prepare('SELECT token_hash FROM community_sessions WHERE namespace=? AND token_hash=?').get(namespace, hashSecret(token))) {
      this.logout(token); return null;
    }
    return this.publicSession(row.account_id, row.expires_at);
  }

  logout(token?: string): void {
    if (validToken(token)) this.options.db.prepare('DELETE FROM community_sessions WHERE namespace=? AND token_hash=?').run(this.options.namespace, hashSecret(token));
  }
  private publicSession(accountId: string, expires: number): CommunitySession {
    return { accountId, expiresAt: new Date(expires).toISOString(), isAdmin: this.options.admins.has(accountId) };
  }
  private async finalizedKey(accountId: string, publicKey: string) {
    try {
      const result = await this.options.provider.viewAccessKey({ accountId, publicKey, finalityQuery: { finality: 'final' } });
      if (result.permission !== 'FullAccess') throw new CommunityError(401, 'key_not_authorized', 'The signing key must still have FullAccess permission on this account.');
      return result;
    } catch (error) {
      if (error instanceof CommunityError) throw error;
      if (error instanceof AccessKeyDoesNotExistError || error instanceof AccountDoesNotExistError) {
        throw new CommunityError(401, 'key_not_authorized', 'The signing key is no longer active on this account.');
      }
      throw new CommunityError(503, 'near_unavailable', 'NEAR could not confirm wallet ownership. Try again when the testnet connection recovers.');
    }
  }
}
