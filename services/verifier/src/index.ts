import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordVerification } from '@gitsettle/shared/db';
import { GitHubClient } from './github.js';
import { NearGateway } from './near.js';
import { VerifierWorker } from './worker.js';

// npm workspace scripts use the workspace as cwd; find the root env without requiring dotenv.
for (const path of [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(path)) process.loadEnvFile(path);
}

const once = process.argv.includes('--once');
const dryRun = process.argv.includes('--dry-run');
const contractId = process.env.NEAR_CONTRACT_ID;
const demoMode = process.env.DEMO_MODE === 'true' || (!contractId && process.env.DEMO_MODE !== 'false');
const intervalMs = Math.max(5_000, Number(process.env.VERIFIER_INTERVAL_MS) || 15_000);
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** SIGTERM stops scheduling new transactions and allows the current finalized call to complete. */
function stop() {
  stopping = true;
  if (timer) clearTimeout(timer);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function main() {
  if (demoMode) {
    console.info('GitSettle verifier: demo mode; no GitHub verification or transactions are performed.');
    if (!once) timer = setInterval(() => {}, 60_000);
    return;
  }
  const verifierId = process.env.NEAR_VERIFIER_ACCOUNT_ID;
  const privateKey = process.env.NEAR_VERIFIER_PRIVATE_KEY;
  if (!contractId || !verifierId || (!privateKey && !dryRun)) {
    throw new Error('Configure NEAR_CONTRACT_ID, NEAR_VERIFIER_ACCOUNT_ID and NEAR_VERIFIER_PRIVATE_KEY (or use --dry-run).');
  }
  const chain = new NearGateway({
    contractId, verifierId, privateKey,
    rpcUrl: process.env.NEAR_RPC_URL ?? 'https://rpc.testnet.near.org',
  });
  await chain.assertConfiguredVerifier();
  const worker = new VerifierWorker(chain, new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    apiVersion: process.env.GITHUB_API_VERSION ?? '2026-03-10',
  }), (record) => {
    recordVerification(record);
    console.info(JSON.stringify({ service: 'gitsettle-verifier', ...record }));
  }, { dryRun, rejectInvalid: process.env.VERIFIER_REJECT_INVALID !== 'false' });

  async function scan() {
    try {
      const result = await worker.tick();
      if (once) console.info(JSON.stringify({ service: 'gitsettle-verifier', ...result, dry_run: dryRun }));
    } catch {
      // SDK errors may include request metadata. Keep service logs credential-free.
      console.error('GitSettle verifier could not read contract state or persist its audit. Check RPC/database configuration.');
      if (once) process.exitCode = 1;
    } finally {
      if (!once && !stopping) timer = setTimeout(scan, intervalMs);
    }
  }
  console.info(`GitSettle verifier: ${dryRun ? 'dry run' : 'live testnet'} for ${contractId}.`);
  await scan();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error && /Configure |does not match|requires named|Use HTTPS/.test(error.message)
    ? error.message : 'GitSettle verifier could not start. Check the testnet account, key, contract and RPC configuration.');
  process.exitCode = 1;
});
