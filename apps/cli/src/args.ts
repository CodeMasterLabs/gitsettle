import { parseNear } from '@gitsettle/shared/format';
import { BOUNTY_TYPES, type BountyStatus, type BountyType } from '@gitsettle/shared/types';

export const DEFAULT_CONTRACT = 'gitsettle-ac1b0f23f4.testnet';
export const DEFAULT_RPC = 'https://test.rpc.fastnear.com';
export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 1) { super(message); }
}
export type Command = 'help' | 'version' | 'list' | 'show' | 'profile' | 'leaderboard' | 'create' | 'claim' | 'submit' | 'release' | 'refund';
export const MUTATIONS = new Set<Command>(['create', 'claim', 'submit', 'release', 'refund']);
export interface CliArgs {
  command: Command; json: boolean; yes: boolean; dryRun: boolean; allowDuplicate: boolean;
  contractId: string; rpcUrl: string; apiUrl?: string; accountId?: string; walletFile?: string;
  id?: number; type?: BountyType; status?: BountyStatus | 'Expired'; locale?: string; minReward?: string;
  repo?: string; issue?: string; reward?: string; deadline?: number; pr?: string;
}
type Environment = Record<string, string | undefined>;
const booleans = new Set(['json', 'yes', 'dry-run', 'allow-duplicate', 'help', 'version']);
const globalOptions = ['contract', 'rpc', 'api', 'account', 'wallet', 'json', 'help', 'version'];
const commandOptions: Record<Command, string[]> = {
  help: [], version: [], list: ['type', 'status', 'locale', 'min-reward'], show: [], profile: [], leaderboard: [],
  create: ['repo', 'issue', 'type', 'locale', 'reward', 'deadline', 'yes', 'dry-run', 'allow-duplicate'],
  claim: ['yes', 'dry-run'], submit: ['pr', 'yes', 'dry-run'], release: ['yes', 'dry-run'], refund: ['yes', 'dry-run'],
};
const valueOptions = new Set([...globalOptions, ...Object.values(commandOptions).flat()].filter(key => !booleans.has(key)));
const bad = (message: string): never => { throw new CliError('invalid_arguments', message, 2); };

export function accountId(value: string): string {
  if (value.length < 2 || value.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) || !value.endsWith('.testnet')) bad('Use a named NEAR testnet account ending in .testnet.');
  return value;
}
export function endpoint(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) bad('Endpoints require HTTPS, or HTTP loopback, without URL credentials, query strings, or fragments.');
    return url.toString().replace(/\/$/, '');
  } catch { return bad('Provide a valid HTTPS endpoint or HTTP loopback URL.'); }
}
export function bountyId(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) bad('A bounty ID must be a nonnegative safe integer.');
  return Number(value);
}
export function exactAmount(value: string, positive = false): string {
  let parsed: string;
  try { parsed = parseNear(value); } catch { return bad('Use a plain NEAR decimal with at most 24 decimal places.'); }
  if ((positive && BigInt(parsed) === 0n) || BigInt(parsed) > 1_000_000n * 10n ** 24n) bad('Reward must be greater than zero and no more than 1,000,000 NEAR.');
  return parsed;
}
export function normalizedLocale(value: string): string {
  const locale = value.toLowerCase();
  if (locale.length < 2 || locale.length > 16 || !/^[a-z]{2}/.test(locale) || !locale.split('-').every(part => /^[a-z0-9]{1,8}$/.test(part))) bad('Use a locale such as es, bn, ja, pt-br, or zh-hant.');
  return locale;
}
export function canonicalUrl(value: string, repo: string, kind: 'issues' | 'pull'): string {
  const prefix = `https://github.com/${repo}/${kind}/`;
  if (value.length > 200 || !value.startsWith(prefix) || !/^[1-9][0-9]{0,15}$/.test(value.slice(prefix.length))) bad('Use a canonical HTTPS GitHub URL in the bounty repository, without queries or fragments.');
  return value;
}
function deadline(value: string, now: number): number {
  const seconds = /^[0-9]+$/.test(value) ? Number(value) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ? Date.parse(value) / 1000 : NaN;
  if (!Number.isSafeInteger(seconds) || seconds <= now || seconds - now > 366 * 86_400) bad('Deadline must be future Unix seconds or YYYY-MM-DDTHH:mm:ssZ, within 366 days.');
  if (value.includes('T') && new Date(seconds * 1000).toISOString().replace('.000Z', 'Z') !== value) bad('Deadline must be a real UTC calendar date.');
  return seconds;
}

/** Strict parsing prevents misspelled flags from silently changing a money operation. */
export function parseArgs(argv: string[], env: Environment = process.env, now = Math.floor(Date.now() / 1000)): CliArgs {
  const options = new Map<string, string | true>(); const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const equals = token.indexOf('='); const key = token.slice(2, equals < 0 ? undefined : equals);
    if ((!booleans.has(key) && !valueOptions.has(key)) || options.has(key)) bad('Unknown or repeated option. Run gitsettle --help for supported flags.');
    if (booleans.has(key)) { if (equals >= 0) bad('Boolean flags do not accept values.'); options.set(key, true); }
    else { const value = equals >= 0 ? token.slice(equals + 1) : argv[++i]; if (!value || value.startsWith('--')) bad('An option value is missing.'); options.set(key, value); }
  }
  const rawCommand = positional.shift() || 'help';
  const command = options.has('help') ? 'help' : options.has('version') ? 'version' : rawCommand === 'post' ? 'create' : rawCommand;
  if (!Object.hasOwn(commandOptions, command)) bad('Unknown command. Run gitsettle --help.');
  const name = command as Command;
  const value = (key: string) => options.get(key) as string | undefined;
  const result: CliArgs = { command: name, json: options.has('json'), yes: options.has('yes'), dryRun: options.has('dry-run'), allowDuplicate: options.has('allow-duplicate'),
    contractId: accountId(value('contract') || env.NEAR_CONTRACT_ID || DEFAULT_CONTRACT), rpcUrl: endpoint(value('rpc') || env.NEAR_RPC_URL || DEFAULT_RPC),
    ...(value('api') || env.GITSETTLE_API_URL ? { apiUrl: endpoint(value('api') || env.GITSETTLE_API_URL!) } : {}),
    ...(value('account') || env.GITSETTLE_ACCOUNT_ID ? { accountId: accountId(value('account') || env.GITSETTLE_ACCOUNT_ID!) } : {}),
    ...(value('wallet') || env.GITSETTLE_WALLET_FILE ? { walletFile: value('wallet') || env.GITSETTLE_WALLET_FILE } : {}) };
  if (name === 'help' || name === 'version') return result;
  for (const key of options.keys()) if (![...globalOptions, ...commandOptions[name]].includes(key)) bad('An option is not supported for this command. Run gitsettle --help.');
  if (['show', 'claim', 'submit', 'release', 'refund'].includes(name)) { if (positional.length !== 1) bad('This command requires exactly one bounty ID.'); result.id = bountyId(positional[0]); }
  else if (name === 'profile') { if (positional.length > 1) bad('Profile accepts one account ID.'); result.accountId = accountId(positional[0] || result.accountId || bad('Profile requires an account ID.')); }
  else if (positional.length) bad('Unexpected positional arguments.');
  if (value('type')) { const type = BOUNTY_TYPES.find(item => item.toLowerCase() === value('type')!.toLowerCase()); if (!type) bad('Unknown work type. Use Bug, Feature, Audit, Translation, or Other.'); result.type = type; }
  if (value('locale')) result.locale = normalizedLocale(value('locale')!);
  if (value('status')) {
    const status = ['Open', 'Claimed', 'Submitted', 'Rejected', 'Releasing', 'Released', 'Refunding', 'Refunded', 'Expired'].find(item => item.toLowerCase() === value('status')!.toLowerCase());
    if (!status) bad('Unknown bounty status.'); result.status = status as CliArgs['status'];
  }
  if (value('min-reward')) result.minReward = exactAmount(value('min-reward')!);
  if (name === 'create') {
    const repo = value('repo') || 'CodeMasterLabs/gitsettle';
    if (repo.length > 140 || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) bad('Repository must be owner/name.');
    result.repo = repo; result.issue = canonicalUrl(value('issue') || bad('Create requires --issue.'), repo, 'issues');
    result.type ||= 'Bug'; result.reward = exactAmount(value('reward') || bad('Create requires --reward.'), true);
    result.deadline = deadline(value('deadline') || bad('Create requires --deadline.'), now);
    if (result.type === 'Translation' && !result.locale) bad('Translation bounties require --locale.');
    if (result.type !== 'Translation' && result.locale) bad('Only translation bounties accept a locale.');
  }
  if (name === 'submit') { if (!value('pr')) bad('Submit requires --pr.'); result.pr = value('pr'); }
  return result;
}

export const HELP = `GitSettle 0.1.0 — native NEAR contribution escrow (testnet only)

Usage: gitsettle <command> [options]
  list [--type Translation] [--locale es] [--status Open] [--min-reward 0.1]
  show <id>
  profile <account.testnet>
  leaderboard
  create (alias: post) --issue <url> --reward <NEAR> --deadline <UTC|seconds>
         [--repo owner/name] [--type Bug|Feature|Audit|Translation|Other] [--locale es]
  claim <id>
  submit <id> --pr <canonical GitHub pull request URL>
  release <id>      Poster or trusted verifier; pays the claimant.
  refund <id>       Poster; expired Open/Claimed/Rejected bounties only.

Global: --contract <account.testnet> --rpc <https-url> --api <https-site>
        --account <account.testnet> --wallet <0600-json-file> --json --help --version
Changes: --dry-run previews only; --yes explicitly authorizes signing.
Without --yes every change stops after a preview. --dry-run always wins.
Create: active issue/type/locale matches also require --allow-duplicate to fund.
Credentials: GITSETTLE_ACCOUNT_ID + GITSETTLE_PRIVATE_KEY, or --wallet.
Never pass a private key as a command-line argument. No secrets enter previews.
--api is an optional source for read commands; changes always use finalized RPC.
Default contract: ${DEFAULT_CONTRACT}
Default RPC: ${DEFAULT_RPC}
Create attaches reward + the on-chain storage reserve; reserve and gas are not rewards.
Docs: https://github.com/CodeMasterLabs/gitsettle/blob/main/docs/CLI.md`;
