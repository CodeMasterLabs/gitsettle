import { formatNear, isExpired } from '@gitsettle/shared/format';
import { confirmTransaction } from '@gitsettle/shared/transactions';
import { canonicalGitHubUrl, duplicateBountyIds } from '@gitsettle/shared/dedupe';
import { BOUNTY_TYPES, type Bounty } from '@gitsettle/shared/types';
import { canonicalUrl, CliError, HELP, MUTATIONS, type CliArgs } from './args.ts';
import type { CliPort, TransactionPlan } from './client.ts';
import type { Credential } from './credentials.ts';

function fail(message: string): never { throw new CliError('action_unavailable', message); }
const yocto = (value: string) => { if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new CliError('invalid_response', 'Contract returned an invalid token amount.'); return BigInt(value); };
export function filterBounties(bounties: Bounty[], args: CliArgs, now = Math.floor(Date.now() / 1000)): Bounty[] {
  return bounties.filter(bounty => (!args.type || bounty.bounty_type === args.type)
    && (!args.locale || bounty.target_locale?.toLowerCase() === args.locale)
    && (!args.status || (args.status === 'Expired' ? isExpired(bounty, now) : bounty.status === args.status && !isExpired(bounty, now)))
    && (!args.minReward || yocto(bounty.reward) >= BigInt(args.minReward)));
}

/** Preview uses finalized contract configuration for the storage reserve and access checks. */
export async function planTransaction(args: CliArgs, port: CliPort, account: string | undefined, now: number): Promise<TransactionPlan> {
  const config = await port.getConfig();
  const plan: TransactionPlan = { network: 'testnet', contractId: args.contractId, accountId: account || null, method: args.command, args: {}, attachedYocto: '0', gasTgas: '100', warnings: [] };
  if (args.command === 'create') {
    if (args.deadline! <= now || args.deadline! - now > 366 * 86_400) fail('The deadline is no longer valid. Choose a future time within 366 days.');
    plan.method = 'create_bounty';
    plan.args = { repo: args.repo!, issue_url: args.issue!, bounty_type: args.type!, target_locale: args.locale || null, reward: args.reward!, deadline: args.deadline! };
    plan.attachedYocto = (yocto(args.reward!) + yocto(config.storage_reserve)).toString();
    plan.warnings.push(`The ${formatNear(config.storage_reserve)} NEAR storage reserve is nonrefundable. Transaction gas is additional.`);
    // Read every finalized page even when an intentional duplicate is allowed.
    // A failed or malformed lookup must never be interpreted as an empty queue.
    const existing = await port.listBounties();
    if (!Array.isArray(existing) || existing.some(bounty => !bounty || !Number.isSafeInteger(bounty.id) || bounty.id < 0
      || typeof bounty.issue_url !== 'string' || !canonicalGitHubUrl(bounty.issue_url, 'issues')
      || !BOUNTY_TYPES.includes(bounty.bounty_type) || !Number.isSafeInteger(bounty.deadline) || bounty.deadline < 0
      || !['Open', 'Claimed', 'Submitted', 'Rejected', 'Releasing', 'Released', 'Refunding', 'Refunded'].includes(bounty.status)
      || !(bounty.target_locale === null || typeof bounty.target_locale === 'string'))) {
      throw new CliError('duplicate_check_unavailable', 'The finalized bounty list could not be validated. No funding transaction was signed.');
    }
    plan.duplicateBountyIds = duplicateBountyIds({ issue_url: args.issue!, bounty_type: args.type!, target_locale: args.locale || null }, existing, now);
    if (plan.duplicateBountyIds.length) plan.warnings.push(`Active bounties already cover this issue, type, and locale: ${plan.duplicateBountyIds.map(id => `#${id}`).join(', ')}. Intentional additional funding requires --allow-duplicate with --yes.`);
    return plan;
  }
  const bounty = await port.getBounty(args.id!);
  if (!bounty || bounty.id !== args.id) fail('Bounty was not found on the selected contract.');
  plan.args = { id: bounty.id };
  if (args.command === 'claim') {
    if (bounty.status !== 'Open' || bounty.deadline <= now) fail('Only an open bounty before its deadline can be claimed.');
    if (account === bounty.poster) fail('The bounty poster cannot claim their own reward.');
    plan.method = 'claim_bounty';
  } else if (args.command === 'submit') {
    if (!['Claimed', 'Rejected'].includes(bounty.status) || bounty.deadline <= now) fail('Submission requires Claimed or Rejected status before the deadline.');
    if (account && account !== bounty.claimant) fail('Only the on-chain claimant can submit this pull request.');
    plan.method = 'submit_pr'; plan.args.pr_url = canonicalUrl(args.pr!, bounty.repo, 'pull');
    plan.warnings.push(`The PR body must include: GitSettle: ${args.contractId}/${bounty.id}/${bounty.claimant}`);
    plan.warnings.push('The trusted verifier checks the merge, repository, issue reference, and locale files before automatic release.');
  } else if (args.command === 'release') {
    if (bounty.status !== 'Submitted') fail('Release requires a submitted bounty.');
    if (account && account !== bounty.poster && account !== config.verifier) fail('Only the poster or configured verifier can release this reward.');
    plan.warnings.push(`This authorizes a ${formatNear(bounty.reward)} NEAR payout to ${bounty.claimant}. Review the PR evidence yourself.`);
    plan.warnings.push('A direct authorized release does not run the automatic verifier or AgentGuard checks.');
  } else if (args.command === 'refund') {
    if (!isExpired(bounty, now)) fail('Refund requires an expired Open, Claimed, or Rejected bounty. Submitted work remains protected.');
    if (account && account !== bounty.poster) fail('Only the bounty poster can refund this reward.');
    plan.warnings.push('The reward returns to the poster; the storage reserve remains with the contract.');
  } else fail('Unsupported escrow action.');
  return plan;
}

export interface RunDependencies { port: CliPort; credential: () => Credential; now?: () => number }
function requireDuplicateOptIn(args: CliArgs, plan: TransactionPlan): void {
  if (plan.duplicateBountyIds?.length && !args.allowDuplicate) {
    throw new CliError('duplicate_bounty', `Active matching bounties: ${plan.duplicateBountyIds.map(id => `#${id}`).join(', ')}. Review them, then use --allow-duplicate with --yes only for intentional additional funding.`);
  }
}
/** No credential is loaded unless --yes is present and --dry-run is absent. */
export async function execute(args: CliArgs, deps: RunDependencies): Promise<Record<string, unknown>> {
  if (args.command === 'help') return { help: HELP };
  if (args.command === 'version') return { version: '0.1.0' };
  const { port } = deps; const now = deps.now || (() => Math.floor(Date.now() / 1000));
  await port.assertTestnet();
  const base = { command: args.command, network: 'testnet', contractId: args.contractId, source: args.apiUrl && !MUTATIONS.has(args.command) ? 'api' : 'finalized_rpc' };
  if (args.command === 'list') return { ...base, bounties: filterBounties(await port.listBounties(), args, now()) };
  if (args.command === 'show') { const bounty = await port.getBounty(args.id!); if (!bounty) throw new CliError('bounty_not_found', 'Bounty was not found.'); return { ...base, bounty }; }
  if (args.command === 'profile') return { ...base, profile: await port.getProfile(args.accountId!) };
  if (args.command === 'leaderboard') return { ...base, entries: await port.getLeaderboard() };
  const preview = await planTransaction(args, port, args.accountId, now());
  if (!args.yes || args.dryRun) return { ...base, status: 'preview', transaction: preview, attachedNear: formatNear(preview.attachedYocto), instruction: args.dryRun ? 'Dry run complete. No transaction signed.' : 'No transaction signed. Review this preview and repeat with --yes to authorize signing.' };
  requireDuplicateOptIn(args, preview);
  const credential = deps.credential();
  const transaction = await planTransaction(args, port, credential.accountId, now());
  requireDuplicateOptIn(args, transaction);
  let outcome: unknown;
  try { outcome = await port.send(transaction, credential); }
  catch { throw new CliError('submission_uncertain', 'Transaction submission did not return a usable result. Check the signer transaction history and bounty before retrying; it may have been submitted.'); }
  const txHash = (outcome as { transaction?: { hash?: unknown } })?.transaction?.hash;
  if (typeof txHash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(txHash)) throw new CliError('confirmation_unavailable', 'No valid transaction hash was returned. Check the signer transaction history and bounty before retrying.');
  const submitted = { ...base, transaction, txHash, explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` };
  try {
    const confirmation = await confirmTransaction({ txHash, accountId: credential.accountId, method: transaction.method, bountyId: args.id, expectedArgs: transaction.args }, args.contractId, outcome, id => port.getBounty(id));
    if (confirmation.status === 'failed' && confirmation.verifiedAction !== true) {
      return { ...submitted, status: 'pending', message: `${confirmation.message} The original requested action is not proven failed; inspect account activity before retrying.`, bounty: null };
    }
    const bounty = confirmation.bountyId === undefined ? null : await port.getBounty(confirmation.bountyId);
    return { ...submitted, status: confirmation.status, message: confirmation.message, bounty };
  } catch {
    // Preserve the submitted hash if a follow-up view fails; never encourage a
    // blind retry of an operation whose receipt may already have executed.
    return { ...submitted, status: 'pending', message: 'Transaction submitted, but final state could not be read. Check this transaction and bounty before retrying.', bounty: null };
  }
}
