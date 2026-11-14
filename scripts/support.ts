import { existsSync, readFileSync } from 'node:fs';
import { Account, JsonRpcProvider, type KeyPairString } from 'near-api-js';

/** Load only the local, ignored environment file. Never print its contents. */
export function loadEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export interface DevelopmentWallet {
  accountId: string;
  publicKey: string;
  privateKey: KeyPairString;
}
export interface DevelopmentWallets {
  network: 'testnet';
  contract: DevelopmentWallet;
  verifier: DevelopmentWallet;
  contributor: DevelopmentWallet;
}
export const walletFile = '.secrets/testnet-wallets.json';

/** Local development wallets are deliberately separate from public deployment metadata. */
export function readWallets(): DevelopmentWallets {
  if (!existsSync(walletFile)) throw new Error('Run npm run wallets first, or configure account environment variables.');
  return JSON.parse(readFileSync(walletFile, 'utf8')) as DevelopmentWallets;
}

export function testnetProvider() {
  const endpoint = process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org';
  return new JsonRpcProvider({ url: endpoint });
}

/** Refuse any accidental switch to mainnet in testnet provisioning/deployment scripts. */
export async function assertTestnet(provider: JsonRpcProvider) {
  const status = await provider.viewNodeStatus();
  if (status.chain_id !== 'testnet') throw new Error(`Expected testnet; RPC reports ${status.chain_id}`);
}

export function walletAccount(wallet: DevelopmentWallet, provider = testnetProvider()) {
  return new Account(wallet.accountId, provider, wallet.privateKey);
}

/** Only an explicit missing-account response permits account creation; outages are not absence. */
export async function accountExists(provider: JsonRpcProvider, accountId: string) {
  try {
    await provider.viewAccount({ accountId, blockQuery: { finality: 'final' } });
    return true;
  } catch (error) {
    if (/UNKNOWN_ACCOUNT|does not exist|doesn't exist/i.test(String(error))) return false;
    throw error;
  }
}

export function safeError(error: unknown) {
  return String(error).replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{70,}/g, '[redacted key]');
}
