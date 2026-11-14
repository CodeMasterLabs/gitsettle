import type { InjectedWallet, SignMessageParams, SignedMessage, WalletModuleFactory } from '@near-wallet-selector/core';
import { walletCatalog } from '@/lib/wallet-catalog';

/** This is the published Nightly injection surface, narrowed to message signing.
 * Its selector adapter currently drops callbackUrl; forwarding the complete
 * challenge preserves GitSettle's origin-bound NEP-413 authentication payload. */
type NightlyWindow = Window & { nightly?: { near?: {
  isConnected: boolean;
  connect(): Promise<unknown>;
  signMessage(params: SignMessageParams): Promise<SignedMessage>;
} } };

async function factoryFor(id: 'my-near-wallet' | 'nightly'): Promise<WalletModuleFactory<InjectedWallet>> {
  switch (id) {
    case 'my-near-wallet': return (await import('@near-wallet-selector/my-near-wallet')).setupMyNearWallet();
    case 'nightly': return (await import('@near-wallet-selector/nightly')).setupNightly();
  }
}

/** Register metadata synchronously; import exactly the provider selected or
 * restored by the user when Wallet Selector requests its behavior. */
export function lazyWalletModules(): WalletModuleFactory<InjectedWallet>[] {
  return walletCatalog.map(definition => async () => ({
    id: definition.id,
    type: 'injected',
    metadata: { name: definition.name, description: definition.description, iconUrl: definition.icon, downloadUrl: definition.website, available: true, deprecated: false },
    async init(options) {
      if (definition.id === 'meteor-wallet' || definition.id === 'intear-wallet') {
        return (await import('./wallet-bridge')).createBridgedWallet(definition.id, options);
      }
      const factory = await factoryFor(definition.id);
      const module = await factory({ options: options.options });
      if (!module) throw new Error(`${definition.name} is unavailable on NEAR Testnet.`);
      const behavior = await module.init(options);
      if (definition.id === 'my-near-wallet') return {
        ...behavior,
        // Omitting contractId in the wallet request avoids generating a local
        // function-call key. Selector still records the intended contract from
        // its outer signIn call; each transaction supplies receiverId explicitly.
        signIn: () => behavior.signIn({}),
        async signAndSendTransaction(params) {
          if (localStorage.getItem('functionCallKey')) throw new Error('An older MyNearWallet connection has a saved access key. Disconnect and reconnect before signing. To revoke the old key on NEAR, remove it in your wallet settings.');
          return behavior.signAndSendTransaction(params);
        },
      };
      return { ...behavior, async signMessage(params: SignMessageParams) {
        const nightly = (window as NightlyWindow).nightly?.near;
        if (!nightly) throw new Error('Nightly is not available. Unlock the extension and reconnect.');
        if (!nightly.isConnected) await nightly.connect();
        return nightly.signMessage(params);
      } };
    },
  }));
}

export async function setupGitSettleWallets(rpcUrl?: string) {
  const { setupWalletSelector } = await import('@near-wallet-selector/core');
  return setupWalletSelector({
    network: rpcUrl ? { networkId: 'testnet', nodeUrl: rpcUrl, helperUrl: 'https://helper.testnet.near.org', explorerUrl: 'https://testnet.nearblocks.io', indexerUrl: 'https://testnet-api.kitwallet.app' } : 'testnet',
    modules: lazyWalletModules(),
    // Stable ordering belongs to our explicit provider catalog, not heuristics.
    optimizeWalletOrder: false,
    randomizeWalletOrder: false,
  });
}
