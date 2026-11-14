import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from 'near-api-js';
import type { Bounty, ContractConfig } from '@gitsettle/shared/types';
import type { ChainPort } from './types.js';

export interface NearGatewayOptions {
  contractId: string;
  rpcUrl: string;
  verifierId: string;
  privateKey?: string;
}

/** Testnet-only transport; credentials never enter the web app or audit logs. */
export class NearGateway implements ChainPort {
  readonly contractId: string;
  private readonly provider: JsonRpcProvider;
  private readonly account?: Account;

  constructor(private readonly options: NearGatewayOptions) {
    if (!options.contractId.endsWith('.testnet') || !options.verifierId.endsWith('.testnet')) {
      throw new Error('GitSettle MVP requires named testnet contract and verifier accounts.');
    }
    const rpc = new URL(options.rpcUrl);
    if (rpc.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(rpc.hostname)) {
      throw new Error('Use HTTPS for a public NEAR RPC endpoint.');
    }
    this.contractId = options.contractId;
    this.provider = new JsonRpcProvider({ url: options.rpcUrl });
    if (options.privateKey) this.account = new Account(options.verifierId, this.provider, options.privateKey as KeyPairString);
  }

  /** Detect a misconfigured signing account before any bounty is processed. */
  async assertConfiguredVerifier(): Promise<void> {
    const status = await this.provider.viewNodeStatus();
    if (status.chain_id !== 'testnet') throw new Error('GitSettle verifier requires a testnet RPC endpoint.');
    const config = await this.view<ContractConfig>('get_config', {});
    if (config?.verifier !== this.options.verifierId) throw new Error('NEAR_VERIFIER_ACCOUNT_ID does not match the contract verifier.');
  }

  private async view<T>(method: string, args: Record<string, unknown>): Promise<T> {
    return await this.provider.callFunction({
      contractId: this.contractId, method, args, blockQuery: { finality: 'final' },
    }) as T;
  }

  async listBounties(): Promise<Bounty[]> {
    const config = await this.view<ContractConfig>('get_config', {});
    if (!Number.isSafeInteger(config.bounty_count) || config.bounty_count < 0) throw new Error('Invalid contract bounty count.');
    const bounties: Bounty[] = [];
    for (let from = 0; from < config.bounty_count; from += 100) {
      const batch = await this.view<Bounty[]>('list_bounties', { from_index: from, limit: 100 });
      if (!Array.isArray(batch) || batch.length !== Math.min(100, config.bounty_count - from)) {
        throw new Error('Incomplete contract bounty page.');
      }
      bounties.push(...batch);
    }
    return bounties;
  }

  getBounty(id: number): Promise<Bounty | null> {
    return this.view('get_bounty', { id });
  }

  private async change(methodName: string, args: Record<string, unknown>): Promise<{ txHash: string }> {
    if (!this.account) throw new Error('No verifier signing key configured; use --dry-run for read-only verification.');
    const result = await this.account.callFunctionRaw({
      contractId: this.contractId, methodName, args, deposit: 0n,
      gas: teraToGas('100'), waitUntil: 'FINAL',
    });
    if (!('transaction' in result) || !result.transaction?.hash) throw new Error('NEAR returned no final transaction hash.');
    return { txHash: result.transaction.hash };
  }

  release(id: number) { return this.change('release', { id }); }
  reject(id: number, reason: string) { return this.change('reject_submission', { id, reason }); }
}
