import { JsonRpcProvider } from 'near-api-js';
import { getBounty } from '@gitsettle/shared/near';
import { CommunityAuth, validateAccount } from './auth.ts';
import { CommunityError } from './errors.ts';
import { openCommunityStore } from './store.ts';
import { CommunityTickets } from './tickets.ts';

/** Canonical origin is configured, never inferred from attacker-controlled proxy headers. */
export function communityOrigin(): string {
  const configured = process.env.APP_ORIGIN || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
  try {
    const url = new URL(configured);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== configured || url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new Error('origin');
    return url.origin;
  } catch { throw new CommunityError(503, 'origin_not_configured', 'Support sign-in needs a valid canonical APP_ORIGIN. Ask the operator to configure it.'); }
}

export interface CommunityServices { origin: string; auth: CommunityAuth; tickets: CommunityTickets }
let services: CommunityServices | undefined;
/** Lazy initialization avoids database writes during a Next production build. */
export function getCommunityServices(): CommunityServices {
  if (!services) {
    const origin = communityOrigin();
    const contract = process.env.NEAR_CONTRACT_ID || '';
    const namespace = `testnet:${contract || 'unconfigured'}:${origin}`;
    const admins = new Set((process.env.SUPPORT_ADMIN_ACCOUNTS || contract).split(',').map(value => value.trim()).filter(Boolean).map(validateAccount));
    const db = openCommunityStore(process.env.DATABASE_PATH || 'data/gitsettle.sqlite');
    const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org' });
    services = { origin, auth: new CommunityAuth({ db, namespace, origin, admins, provider }),
      tickets: new CommunityTickets({ db, namespace, getBounty: async id => {
        if (process.env.DEMO_MODE === 'true' || !contract) throw new Error('Appeals require a configured live contract.');
        return getBounty(id);
      } }) };
  }
  return services;
}
