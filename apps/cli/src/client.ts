import { Account, JsonRpcProvider, teraToGas } from 'near-api-js';
import type { Bounty, ContractConfig, Contributor } from '@gitsettle/shared/types';
import { CliError, type CliArgs } from './args.ts';
import type { Credential } from './credentials.ts';

export interface TransactionPlan { network: 'testnet'; contractId: string; accountId: string | null; method: string; args: Record<string, unknown>; attachedYocto: string; gasTgas: '100'; warnings: string[]; duplicateBountyIds?: number[] }
/** Minimal port allows lifecycle tests to prove exactly when signing is possible. */
export interface CliPort {
  assertTestnet(): Promise<void>;
  getConfig(): Promise<ContractConfig>;
  listBounties(): Promise<Bounty[]>;
  getBounty(id: number): Promise<Bounty | null>;
  getProfile(account: string): Promise<Contributor>;
  getLeaderboard(): Promise<Contributor[]>;
  send(plan: TransactionPlan, credential: Credential): Promise<unknown>;
}

/** Read-only API convenience never participates in transaction construction or confirmation. */
export class NearCliPort implements CliPort {
  private provider: JsonRpcProvider;
  constructor(private readonly settings: CliArgs, private readonly useApi = false, private readonly fetcher: typeof fetch = fetch) {
    this.provider = new JsonRpcProvider({ url: settings.rpcUrl });
  }
  private async api(path: string): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(`${this.settings.apiUrl}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
      if (!response.ok || !response.body) throw new Error('status');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw new Error('size'); } chunks.push(next.value); } }
      finally { reader.releaseLock(); }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
      return value;
    } catch { throw new CliError('api_unavailable', 'The configured API did not return a valid bounded response. Retry or omit --api to read finalized RPC directly.'); }
  }
  async assertTestnet(): Promise<void> {
    if (this.useApi) {
      const config = await this.api('/api/config');
      if (config.mode !== 'testnet' || config.network !== 'testnet' || config.contractId !== this.settings.contractId) throw new CliError('network_mismatch', 'API must be in testnet mode and use the selected contract.');
      return;
    }
    const status = await this.provider.viewNodeStatus();
    if (status.chain_id !== 'testnet') throw new CliError('network_mismatch', 'The configured RPC is not NEAR testnet. No transaction was signed.');
  }
  private async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return await this.provider.callFunction({ contractId: this.settings.contractId, method, args, blockQuery: { finality: 'final' } }) as T;
  }
  getConfig(): Promise<ContractConfig> { return this.view('get_config'); }
  async listBounties(): Promise<Bounty[]> {
    if (this.useApi) { const result = (await this.api('/api/bounties')).bounties; if (!Array.isArray(result)) throw new CliError('invalid_response', 'API returned no bounty list.'); return result as Bounty[]; }
    const { bounty_count: count } = await this.getConfig();
    if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) throw new CliError('invalid_response', 'Contract bounty count is invalid or above the CLI safety limit.');
    const result: Bounty[] = [];
    for (let from = 0; from < count; from += 100) {
      const page = await this.view<Bounty[]>('list_bounties', { from_index: from, limit: 100 });
      if (!Array.isArray(page) || page.length !== Math.min(100, count - from)) throw new CliError('invalid_response', 'Contract returned an incomplete bounty page.');
      result.push(...page);
    }
    return result;
  }
  async getBounty(id: number): Promise<Bounty | null> { return this.useApi ? (await this.api(`/api/bounties/${id}`)).bounty as Bounty | null : this.view('get_bounty', { id }); }
  async getProfile(account: string): Promise<Contributor> { return this.useApi ? (await this.api(`/api/contributors/${account}`)).profile as Contributor : this.view('get_profile', { account_id: account }); }
  async getLeaderboard(): Promise<Contributor[]> { return this.useApi ? (await this.api('/api/leaderboard')).entries as Contributor[] : this.view('get_leaderboard', { from_index: 0, limit: 100 }); }
  async send(plan: TransactionPlan, credential: Credential): Promise<unknown> {
    if (this.useApi || plan.contractId !== this.settings.contractId || plan.accountId !== credential.accountId) throw new CliError('unsafe_transaction', 'Transaction context does not match the selected signer and contract.');
    await this.assertTestnet();
    const account = new Account(credential.accountId, this.provider, credential.privateKey);
    return account.callFunctionRaw({ contractId: plan.contractId, methodName: plan.method, args: plan.args, deposit: BigInt(plan.attachedYocto), gas: teraToGas(plan.gasTgas), waitUntil: 'FINAL' });
  }
}
