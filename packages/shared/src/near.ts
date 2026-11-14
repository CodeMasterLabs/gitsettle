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
    mode: demo ? 'demo' : 'testnet', contractId, rpcUrl: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com', network: 'testnet',
    automation: { agentGuardEnabled: enabled === 'true', maxAutomaticPayoutYocto },
  };
}

let provider: { url: string; instance: JsonRpcProvider } | undefined;
/** Reuse the transport rather than constructing it for each view. No result is cached here. */
export function getProvider() {
  const url = publicConfig().rpcUrl;
  if (!provider || provider.url !== url) provider = { url, instance: new JsonRpcProvider({ url }) };
  return provider.instance;
}

/** Finalized views are authoritative; a provider failure is never replaced with demo balances.
 * Public reads use the documented JSON-RPC query shape with an abort deadline.
 * This avoids the SDK's twelve-attempt default retry loop holding a page open.
 * SDK signing/transaction lookup remains separate and is never retried here.
 */
export async function viewContract<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const { contractId, rpcUrl } = publicConfig();
  if (!contractId) throw new Error('Testnet contract is not configured.');
  const response = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'gitsettle-view', method: 'query', params: {
      request_type: 'call_function', account_id: contractId, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'final',
    } }),
    signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error('NEAR finalized view is temporarily unavailable.');
  const value = await response.json() as { error?: unknown; result?: { result?: unknown; block_height?: unknown; block_hash?: unknown } };
  const result = value?.result;
  if (value?.error || !result || !Number.isSafeInteger(result.block_height) || typeof result.block_hash !== 'string'
    || !Array.isArray(result.result) || result.result.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('NEAR returned an incomplete finalized view.');
  }
  return JSON.parse(Buffer.from(result.result).toString('utf8')) as T;
}
export const getConfig = () => viewContract<ContractConfig>('get_config');
export const getBounty = (id: number) => viewContract<Bounty | null>('get_bounty', { id });
export const getProfile = (account: string) => viewContract<Contributor>('get_profile', { account_id: account });

/** IDs are contiguous. Known config/first-page inputs avoid repeated reads by the board.
 * Four page reads at a time bound RPC load for larger self-hosted queues.
 */
export async function fetchBounties(configuration?: ContractConfig, initialPage?: Bounty[]): Promise<Bounty[]> {
  const { bounty_count } = configuration ?? await getConfig();
  if (!Number.isSafeInteger(bounty_count) || bounty_count < 0) throw new Error('Invalid contract bounty count.');
  const result: Bounty[] = [];
  for (let batch = 0; batch < bounty_count; batch += 400) {
    const starts = Array.from({ length: Math.min(4, Math.ceil((bounty_count - batch) / 100)) }, (_, index) => batch + index * 100);
    const pages = await Promise.all(starts.map(async from => {
      const expected = Math.min(100, bounty_count - from);
      let page = from === 0 && initialPage ? initialPage : await viewContract<Bounty[]>('list_bounties', { from_index: from, limit: 100 });
      // The speculative first page may finalize just before a newly funded
      // bounty raises config.bounty_count. Retry that page once with fresh state.
      if (from === 0 && initialPage && Array.isArray(page) && page.length < expected) page = await viewContract<Bounty[]>('list_bounties', { from_index: from, limit: 100 });
      if (!Array.isArray(page) || page.length < expected || page.slice(0, expected).some((bounty, index) => bounty?.id !== from + index)) {
        throw new Error('Incomplete contract bounty pagination.');
      }
      // Ignore bounties created after this configuration read; the next short
      // display refresh includes them. Every returned row is finalized data.
      return page.slice(0, expected);
    }));
    result.push(...pages.flat());
  }
  return result;
}

export const fetchLeaderboard = () => viewContract<Contributor[]>('get_leaderboard', { from_index: 0, limit: 100 });
