import { JsonRpcProvider } from 'near-api-js';
import type { Bounty, ContractConfig, Contributor, PublicConfig } from './types.ts';
import { parseNear } from './format.ts';

/** Runtime config is allowlisted explicitly; private signer variables never enter web responses. */
export function publicConfig(): PublicConfig {
  const contractId = process.env.NEAR_CONTRACT_ID || null;
  const demo = process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE !== 'false' && !contractId);
  if (!demo && !contractId) throw new Error('NEAR_CONTRACT_ID is required when DEMO_MODE=false.');
  if (contractId && !contractId.endsWith('.testnet')) throw new Error('This build supports NEAR testnet accounts only.');
  const enabled = process.env.AGENTGUARD_ENABLED || 'true';
  if (!['true', 'false'].includes(enabled)) throw new Error('AGENTGUARD_ENABLED must be true or false.');
  const maxAutomaticPayoutYocto = parseNear(process.env.AGENTGUARD_MAX_PAYOUT_NEAR || '5');
  if (BigInt(maxAutomaticPayoutYocto) <= 0n || BigInt(maxAutomaticPayoutYocto) > 1_000_000n * 10n ** 24n) throw new Error('Invalid automatic payout cap.');
  return {
    mode: demo ? 'demo' : 'testnet', contractId, rpcUrl: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org', network: 'testnet',
    automation: { agentGuardEnabled: enabled === 'true', maxAutomaticPayoutYocto },
  };
}

export function getProvider() { return new JsonRpcProvider({ url: publicConfig().rpcUrl }); }

/** Finalized views are authoritative; a provider failure is never replaced with demo balances. */
export async function viewContract<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const { contractId } = publicConfig();
  if (!contractId) throw new Error('Testnet contract is not configured.');
  const value = await getProvider().callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
  return value as T;
}
export const getConfig = () => viewContract<ContractConfig>('get_config');
export const getBounty = (id: number) => viewContract<Bounty | null>('get_bounty', { id });
export const getProfile = (account: string) => viewContract<Contributor>('get_profile', { account_id: account });

/** IDs are contiguous; fetch in bounded pages so the worker never misses a later submission. */
export async function fetchBounties(): Promise<Bounty[]> {
  const { bounty_count } = await getConfig();
  const result: Bounty[] = [];
  for (let from = 0; from < bounty_count; from += 100) {
    const page = await viewContract<Bounty[]>('list_bounties', { from_index: from, limit: 100 });
    if (!Array.isArray(page) || !page.length) throw new Error('Incomplete contract bounty pagination.');
    result.push(...page);
  }
  return result;
}

export const fetchLeaderboard = () => viewContract<Contributor[]>('get_leaderboard', { from_index: 0, limit: 100 });
