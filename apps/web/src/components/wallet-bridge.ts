import type { InjectedWallet, WalletBehaviourOptions } from '@near-wallet-selector/core';
import type { NearConnector, WalletManifest } from '@hot-labs/near-connect';
import pinnedManifest from '@/lib/wallet-manifest.json';

let connectorPromise: Promise<NearConnector> | undefined;

/** postMessage providers can reject with a string instead of an Error. Keep a
 * useful user-visible rejection while preserving the transaction safety path. */
async function providerCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (reason) {
    if (reason instanceof Error) throw reason;
    throw new Error(typeof reason === 'string' ? reason : 'The wallet request could not be completed.');
  }
}

/** NEAR Connect runs the two explicitly reviewed executors in isolated frames.
 * A supplied empty registry prevents a mutable upstream manifest from silently
 * expanding our provider list. Each bridge below uses a pinned SandboxWallet. */
async function connector(rpcUrl: string) {
  if (!connectorPromise) connectorPromise = import('@hot-labs/near-connect').then(({ NearConnector }) => new NearConnector({
    network: 'testnet', providers: { testnet: [rpcUrl] }, autoConnect: false,
    manifest: { version: pinnedManifest.version, wallets: [] }, footerBranding: null,
    features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
  })).catch(reason => { connectorPromise = undefined; throw reason; });
  return connectorPromise;
}

/** Adapt NEAR Connect to the existing Wallet Selector transaction boundary.
 * No addFunctionCallKey/contractId goes to signIn: the provider retains signing
 * keys and approval UI. Selector still tracks account/contract and emits events. */
export async function createBridgedWallet(id: 'meteor-wallet' | 'intear-wallet', options: WalletBehaviourOptions<InjectedWallet>): Promise<Omit<InjectedWallet, 'id' | 'type' | 'metadata'>> {
  const manifest = pinnedManifest.wallets.find(wallet => wallet.id === id);
  if (!manifest || !manifest.features.testnet || !manifest.features.signInWithoutAddKey) throw new Error('This wallet does not support testnet connections without an access key.');
  const { SandboxWallet } = await import('@hot-labs/near-connect');
  // Published types describe platform as string[]; the official manifest uses
  // a map. SandboxWallet does not use platform; the snapshot is runtime-checked.
  const wallet = new SandboxWallet(await connector(options.options.network.nodeUrl), manifest as unknown as WalletManifest);
  const unsupported = async () => { throw new Error(`This operation is not supported by ${manifest.name}.`); };
  return {
    signIn: () => providerCall(() => wallet.signIn({ network: 'testnet' })),
    signOut: () => providerCall(() => wallet.signOut({ network: 'testnet' })),
    getAccounts: () => providerCall(() => wallet.getAccounts({ network: 'testnet' })),
    signMessage: params => providerCall(() => wallet.signMessage({ ...params, network: 'testnet' })),
    signAndSendTransaction: params => {
      const receiverId = params.receiverId || options.store.getState().contract?.contractId;
      if (!receiverId) throw new Error('An escrow contract is required.');
      return providerCall(() => wallet.signAndSendTransaction({ ...params, receiverId, network: 'testnet' }));
    },
    signAndSendTransactions: params => providerCall(() => wallet.signAndSendTransactions({ ...params, network: 'testnet' })),
    verifyOwner: unsupported, getPublicKey: unsupported, signTransaction: unsupported,
    signNep413Message: unsupported, signDelegateAction: unsupported,
  };
}
