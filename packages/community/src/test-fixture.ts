import { KeyPair, KeyPairSigner, PublicKey, type Provider } from 'near-api-js';
import { AccessKeyDoesNotExistError } from 'near-api-js/rpc-errors';
import type { Bounty } from '@gitsettle/shared/types';
import { CommunityAuth } from './auth.ts';
import { openCommunityStore } from './store.ts';
import { CommunityTickets } from './tickets.ts';
import type { AuthChallenge, CommunitySession } from './types.ts';

export const ORIGIN = 'https://gitsettle.example';
export const account = 'alice.testnet';
export const viewer = (accountId = account, isAdmin = false): CommunitySession => ({ accountId, isAdmin, expiresAt: '2027-01-01T00:00:00.000Z' });
export const bounty = (overrides: Partial<Bounty> = {}): Bounty => ({ id: 9, poster: 'poster.testnet', claimant: account,
  repo: 'CodeMasterLabs/gitsettle', issue_url: 'https://github.com/CodeMasterLabs/gitsettle/issues/9', bounty_type: 'Translation',
  target_locale: 'es', reward: '50000000000000000000000', deadline: 2_000_000_000, status: 'Submitted',
  pr_url: 'https://github.com/CodeMasterLabs/gitsettle/pull/10', created_at: 1_700_000_000, submitted_at: 1_700_000_001,
  settled_at: null, rejection_reason: null, ...overrides });

/** Fresh in-memory keys exist only in tests; no network or transaction calls are made. */
export function fixture() {
  const db = openCommunityStore(':memory:');
  let now = 1_800_000_000_000;
  const signer = new KeyPairSigner(KeyPair.fromRandom('ed25519'));
  let permission: 'FullAccess' | 'FunctionCall' | 'missing' | 'unavailable' = 'FullAccess';
  let chainBounty: Bounty | null = bounty();
  let chainFailure = false;
  const queries: Parameters<Provider['viewAccessKey']>[0][] = [];
  const provider: Pick<Provider, 'viewAccessKey'> = { viewAccessKey: async args => {
    queries.push(args);
    if (permission === 'unavailable') throw new Error('private RPC context must not leak');
    if (permission === 'missing') throw new AccessKeyDoesNotExistError(PublicKey.from(args.publicKey), '11111111111111111111111111111111', 100);
    return { nonce: 0n, block_height: 100, block_hash: '11111111111111111111111111111111',
      permission: permission === 'FullAccess' ? 'FullAccess' : { FunctionCall: { allowance: null, receiver_id: 'gitsettle.testnet', method_names: ['release'] } } };
  } };
  const options = { db, namespace: `testnet:gitsettle.testnet:${ORIGIN}`, origin: ORIGIN,
    admins: new Set(['admin.testnet']), provider, now: () => now };
  const auth = new CommunityAuth(options);
  const tickets = new CommunityTickets({ db, namespace: options.namespace, now: () => now, getBounty: async () => {
    if (chainFailure) throw new Error('RPC unavailable');
    return chainBounty;
  } });
  async function sign(challenge: AuthChallenge, changes: Partial<AuthChallenge> = {}, signerAccount = account) {
    const payload = { ...challenge, ...changes };
    const result = await signer.signNep413Message(signerAccount, { message: payload.message, nonce: Buffer.from(payload.nonce, 'base64'), recipient: payload.recipient, callbackUrl: payload.callbackUrl });
    return { challengeId: challenge.challengeId, accountId: result.accountId, publicKey: result.publicKey.toString(), signature: Buffer.from(result.signature).toString('base64') };
  }
  async function login(signerAccount = account) {
    const { challenge, browserToken } = auth.createChallenge({ accountId: signerAccount });
    return auth.establishSession(await sign(challenge, {}, signerAccount), browserToken);
  }
  return { db, auth, tickets, options, queries, sign, login, services: { origin: ORIGIN, auth, tickets },
    advance: (ms: number) => { now += ms; }, setPermission: (value: typeof permission) => { permission = value; },
    setBounty: (value: Bounty | null) => { chainBounty = value; }, failBounty: () => { chainFailure = true; } };
}
