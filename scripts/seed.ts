import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Account, teraToGas, type KeyPairString } from 'near-api-js';
import { parseNear } from '@gitsettle/shared/format';
import { saveMetadata } from '@gitsettle/shared/db';
import type { Bounty, BountyType, ContractConfig } from '@gitsettle/shared/types';
import { assertTestnet, loadEnvironment, readWallets, safeError, testnetProvider } from './support.js';

interface SeedIssue { issue_url: string; title: string; description: string; bounty_type: BountyType; target_locale: string | null; reward_near: string }

/** Fund actual repository issues sequentially. Re-running never duplicates a poster's matching seed. */
async function main() {
  loadEnvironment();
  const wallets = process.env.NEAR_POSTER_PRIVATE_KEY ? null : readWallets();
  const contractId = process.env.NEAR_CONTRACT_ID || wallets?.contract.accountId;
  const posterId = process.env.NEAR_POSTER_ACCOUNT_ID || wallets?.contract.accountId;
  const privateKey = process.env.NEAR_POSTER_PRIVATE_KEY || wallets?.contract.privateKey;
  if (!contractId || !posterId || !privateKey || !contractId.endsWith('.testnet')) throw new Error('Configure testnet poster and contract, or run npm run wallets and npm run deploy.');
  const provider = testnetProvider();
  await assertTestnet(provider);
  const path = process.env.SEED_ISSUES_PATH || 'docs/SEED_ISSUES.json';
  if (!existsSync(path)) throw new Error('Create actual GitHub issues and record them in docs/SEED_ISSUES.json before seeding. See README.md.');
  const issues = JSON.parse(readFileSync(path, 'utf8')) as SeedIssue[];
  if (!Array.isArray(issues) || !issues.length) throw new Error('Seed manifest must contain GitHub issue records.');
  process.env.NEAR_CONTRACT_ID = contractId;
  process.env.DEMO_MODE = 'false';
  const view = async <T>(method: string, args: Record<string, unknown> = {}) => await provider.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } }) as T;
  const config = await view<ContractConfig>('get_config');
  const existing: Bounty[] = [];
  for (let from = 0; from < config.bounty_count; from += 100) existing.push(...await view<Bounty[]>('list_bounties', { from_index: from, limit: 100 }));
  const account = new Account(posterId, provider, privateKey as KeyPairString);
  const results = [];
  for (const issue of issues) {
    if (!/^https:\/\/github\.com\/CodeMasterLabs\/gitsettle\/issues\/[1-9]\d*$/.test(issue.issue_url)) throw new Error('Seed issue must belong to CodeMasterLabs/gitsettle.');
    const duplicate = existing.find(b => b.issue_url === issue.issue_url && b.poster === posterId && b.bounty_type === issue.bounty_type && b.target_locale === issue.target_locale);
    if (duplicate) { results.push({ id: duplicate.id, issue_url: issue.issue_url, skipped_existing: true }); continue; }
    const reward = parseNear(issue.reward_near);
    const args = { repo: 'CodeMasterLabs/gitsettle', issue_url: issue.issue_url, bounty_type: issue.bounty_type, target_locale: issue.target_locale, reward, deadline: Math.floor(Date.now() / 1000) + 14 * 86_400 };
    const deposit = BigInt(reward) + BigInt(config.storage_reserve);
    if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ args, attached_yocto: deposit.toString() })); continue; }
    const result = await account.callFunctionRaw({ contractId, methodName: 'create_bounty', args, deposit, gas: teraToGas('100'), waitUntil: 'FINAL' });
    const status = result.status;
    if (!status || typeof status !== 'object' || !('SuccessValue' in status)) throw new Error('Seed transaction was not finalized successfully.');
    const bounty = JSON.parse(Buffer.from(status.SuccessValue, 'base64').toString('utf8')) as Bounty;
    saveMetadata(bounty.id, issue.title, issue.description);
    existing.push(bounty);
    results.push({ id: bounty.id, issue_url: issue.issue_url, reward: bounty.reward, transaction_hash: result.transaction?.hash });
    console.log(`Funded bounty #${bounty.id}: ${issue.title}`);
  }
  if (!process.argv.includes('--dry-run')) writeFileSync('docs/SEED_RESULTS.json', JSON.stringify({ contract_id: contractId, seeded_at: new Date().toISOString(), bounties: results }, null, 2) + '\n');
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
