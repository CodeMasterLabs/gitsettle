import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { KeyPair, nearToYocto } from 'near-api-js';
import {
  accountExists, assertTestnet, loadEnvironment, readWallets, safeError,
  testnetProvider, walletAccount, walletFile, type DevelopmentWallet, type DevelopmentWallets,
} from './support.js';

/** Provision one faucet account and two funded subaccounts, resuming safely after interruptions. */
async function main() {
  loadEnvironment();
  const provider = testnetProvider();
  await assertTestnet(provider);
  let wallets: DevelopmentWallets;
  if (existsSync(walletFile)) {
    wallets = readWallets();
  } else {
    const root = `gitsettle-${randomBytes(5).toString('hex')}.testnet`;
    const generate = (accountId: string): DevelopmentWallet => {
      const key = KeyPair.fromRandom('ed25519');
      return { accountId, publicKey: key.getPublicKey().toString(), privateKey: key.toString() };
    };
    wallets = { network: 'testnet', contract: generate(root), verifier: generate(`verifier.${root}`), contributor: generate(`contributor.${root}`) };
    mkdirSync('.secrets', { recursive: true, mode: 0o700 });
    // Save before calling the faucet so a network interruption cannot lose a funded key.
    writeFileSync(walletFile, JSON.stringify(wallets, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  if (!(await accountExists(provider, wallets.contract.accountId))) {
    const response = await fetch('https://helper.nearprotocol.com/account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAccountId: wallets.contract.accountId, newAccountPublicKey: wallets.contract.publicKey }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Testnet faucet returned HTTP ${response.status}. Wallets saved locally; rerun after resolving faucet availability.`);
    await response.json();
  }
  const rootAccount = walletAccount(wallets.contract, provider);
  for (const wallet of [wallets.verifier, wallets.contributor]) {
    if (!(await accountExists(provider, wallet.accountId))) {
      await rootAccount.createAccount({ newAccountId: wallet.accountId, publicKey: wallet.publicKey, nearToTransfer: nearToYocto('0.5') });
    }
    await provider.viewAccessKey({ accountId: wallet.accountId, publicKey: wallet.publicKey, finalityQuery: { finality: 'final' } });
    console.log(`Ready: ${wallet.accountId}`);
  }
  console.log(`Ready: ${wallets.contract.accountId}. Private keys saved only in ${walletFile}.`);
}

main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
