/** Public provider metadata is deliberately independent of signing SDKs.
 * Opening the picker never downloads cryptography or initializes a wallet. */
export const walletCatalog = [
  { id: 'my-near-wallet', name: 'MyNearWallet', description: 'Connect in a secure browser window', kind: 'Web wallet', icon: '/wallets/my-near-wallet.png', website: 'https://testnet.mynearwallet.com', support: true },
  { id: 'meteor-wallet', name: 'Meteor Wallet', description: 'Your Meteor account, in a browser popup', kind: 'Web wallet', icon: '/wallets/meteor-wallet.png', website: 'https://wallet.meteorwallet.app', support: true },
  { id: 'intear-wallet', name: 'Intear Wallet', description: 'Connect with the Intear wallet app', kind: 'Web & mobile', icon: '/wallets/intear-wallet.svg', website: 'https://wallet.intear.tech', support: false },
  { id: 'nightly', name: 'Nightly', description: 'Connect your installed browser extension', kind: 'Extension', icon: '/wallets/nightly.svg', website: 'https://nightly.app/download', support: true },
] as const;

export type WalletId = typeof walletCatalog[number]['id'];
export type WalletDefinition = typeof walletCatalog[number];

export function walletDefinition(id: string | null): WalletDefinition | undefined {
  return walletCatalog.find(wallet => wallet.id === id);
}
