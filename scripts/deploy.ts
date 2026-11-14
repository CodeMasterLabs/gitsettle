import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { actions, teraToGas } from 'near-api-js';
import { assertTestnet, loadEnvironment, readWallets, safeError, testnetProvider, walletAccount } from './support.js';

/** Deploy and initialize atomically. Never overwrite a deployed contract from this convenience script. */
async function main() {
  loadEnvironment();
  const wallets = readWallets();
  const provider = testnetProvider();
  await assertTestnet(provider);
  const contract = walletAccount(wallets.contract, provider);
  const wasmPath = process.env.CONTRACT_WASM_PATH || 'contracts/gitsettle/target/wasm32-unknown-unknown/release/gitsettle.wasm';
  if (!existsSync(wasmPath)) throw new Error('Build the contract Wasm first; see docs/CONTRACT.md.');
  const code = readFileSync(wasmPath);
  const account = await provider.viewAccount({ accountId: wallets.contract.accountId, blockQuery: { finality: 'final' } });
  if (account.code_hash !== '11111111111111111111111111111111') {
    throw new Error('Contract account already has code. Read docs/DEPLOYMENT.json; this script never silently upgrades a funded escrow.');
  }
  const outcome = await contract.signAndSendTransaction({
    receiverId: contract.accountId,
    actions: [actions.deployContract(code), actions.functionCall('new', { verifier: wallets.verifier.accountId }, teraToGas('30'), 0n)],
    waitUntil: 'FINAL',
  });
  const config = await provider.callFunction({ contractId: contract.accountId, method: 'get_config', args: {}, blockQuery: { finality: 'final' } });
  mkdirSync('docs', { recursive: true });
  const deployment = {
    network: 'testnet', contract_id: contract.accountId, verifier_id: wallets.verifier.accountId,
    contributor_id: wallets.contributor.accountId, rpc_url: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org',
    wasm_sha256: createHash('sha256').update(code).digest('hex'),
    transaction_hash: outcome.transaction?.hash, deployed_at: new Date().toISOString(), config,
  };
  writeFileSync('docs/DEPLOYMENT.json', JSON.stringify(deployment, null, 2) + '\n');
  // .env.testnet is ignored and contains only development credentials, never mainnet keys.
  const environment = [
    'DEMO_MODE=false', `NEAR_RPC_URL=${deployment.rpc_url}`, `NEAR_CONTRACT_ID=${contract.accountId}`,
    `NEAR_VERIFIER_ACCOUNT_ID=${wallets.verifier.accountId}`, `NEAR_VERIFIER_PRIVATE_KEY=${wallets.verifier.privateKey}`,
    `NEAR_POSTER_ACCOUNT_ID=${wallets.contract.accountId}`, `NEAR_POSTER_PRIVATE_KEY=${wallets.contract.privateKey}`,
    `NEAR_CONTRIBUTOR_ACCOUNT_ID=${wallets.contributor.accountId}`, `NEAR_CONTRIBUTOR_PRIVATE_KEY=${wallets.contributor.privateKey}`,
    'DATABASE_PATH=./data/gitsettle.sqlite', 'GITHUB_API_VERSION=2026-03-10',
  ].join('\n') + '\n';
  writeFileSync('.env.testnet', environment, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(deployment, null, 2));
  console.log('Testnet environment saved to ignored .env.testnet. Copy to .env to run this deployment.');
}

main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
