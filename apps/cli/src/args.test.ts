import assert from 'node:assert/strict';
import test from 'node:test';
import { CliError, DEFAULT_CONTRACT, parseArgs } from './args.ts';
import { filterBounties } from './commands.ts';
import { terminalText } from './output.ts';
import type { Bounty } from '@gitsettle/shared/types';

const now = 1_800_000_000;
const post = ['post', '--issue', 'https://github.com/CodeMasterLabs/gitsettle/issues/9', '--reward', '0.000000000000000000000001', '--deadline', String(now + 100)];
const parse = (values: string[]) => parseArgs(values, {}, now);

test('defaults and aliases target testnet; decimals preserve a single yoctoNEAR', () => {
  const args = parse(post);
  assert.equal(args.command, 'create'); assert.equal(args.contractId, DEFAULT_CONTRACT); assert.equal(args.reward, '1'); assert.equal(args.type, 'Bug'); assert.equal(args.yes, false);
  assert.equal(parse(['list', '--type=translation', '--locale=ES', '--min-reward=1.000000000000000000000001']).minReward, '1000000000000000000000001');
  assert.equal(parse(['list', '--type=translation', '--locale=ES']).locale, 'es');
});

test('unsafe amounts, dates, accounts, IDs, flags and secret command-line options are rejected', () => {
  for (const amount of ['-1', '1e2', '0', 'NaN', '1,000', '01', '1000000.1', '0.0000000000000000000000001']) {
    const args = [...post]; args[args.indexOf('--reward') + 1] = amount; assert.throws(() => parse(args), CliError);
  }
  for (const deadline of [String(now), String(now + 367 * 86_400), 'tomorrow', '2027-01-01', '2027-02-30T12:00:00Z', '1799000000000']) {
    const args = [...post]; args[args.indexOf('--deadline') + 1] = deadline; assert.throws(() => parse(args), CliError);
  }
  for (const args of [['show', '-1'], ['claim', '1.0'], ['refund', '9007199254740992'], ['profile', 'alice.near'], ['list', '--contract', 'mainnet.near'], ['list', '--wat'], ['list', '--type', 'Bug', '--type', 'Audit'], ['claim', '1', '--yes=false'], ['__proto__'], ['constructor'], ['list', '--yes'], ['claim', '1', '--private-key', 'SECRET']]) assert.throws(() => parse(args), CliError);
});

test('endpoint and canonical issue validation reject URL tricks without reflecting credentials', () => {
  for (const url of ['http://remote.example', 'https://user:SECRET@host.example', 'https://host.example?token=SECRET', 'https://host.example#secret', 'file:///tmp/file']) {
    assert.throws(() => parse(['list', '--rpc', url]), (error: unknown) => error instanceof CliError && !error.message.includes('SECRET'));
  }
  assert.equal(parse(['list', '--rpc', 'http://127.0.0.1:3030']).rpcUrl, 'http://127.0.0.1:3030');
  for (const issue of ['https://github.com.evil.example/CodeMasterLabs/gitsettle/issues/9', 'https://github.com/CodeMasterLabs/gitsettle/issues/9?x=y', 'https://github.com/other/repo/issues/9', 'https://github.com/CodeMasterLabs/gitsettle/issues/01']) {
    const args = [...post]; args[args.indexOf('--issue') + 1] = issue; assert.throws(() => parse(args), CliError);
  }
});

test('translation requires a normalized locale and other categories reject locale injection', () => {
  assert.throws(() => parse([...post, '--type', 'Translation']), CliError);
  assert.equal(parse([...post, '--type', 'translation', '--locale', 'PT-BR']).locale, 'pt-br');
  assert.throws(() => parse([...post, '--locale', 'es']), CliError);
  assert.throws(() => parse([...post, '--type', 'Translation', '--locale', '../../etc']), CliError);
});

test('filters use exact amounts and preserve submitted work after deadline', () => {
  const bounty = { id: 1, bounty_type: 'Translation', target_locale: 'es', reward: '1000000000000000000000001', status: 'Submitted', deadline: now - 1 } as Bounty;
  assert.equal(filterBounties([bounty], parse(['list', '--type', 'Translation', '--locale', 'es', '--status', 'Submitted', '--min-reward', '1.000000000000000000000001']), now).length, 1);
  assert.equal(filterBounties([bounty], parse(['list', '--min-reward', '1.000000000000000000000002']), now).length, 0);
  assert.equal(filterBounties([bounty], parse(['list', '--status', 'Expired']), now).length, 0);
  assert.equal(filterBounties([{ ...bounty, status: 'Claimed' }], parse(['list', '--status', 'Expired']), now).length, 1);
});

test('terminal output strips escape and directional control characters', () => {
  assert.equal(terminalText('repo\u001b[2J\u202e'), 'repo[2J');
});

test('duplicate opt-in is an explicit create/post-only boolean', () => {
  assert.equal(parse([...post, '--allow-duplicate']).allowDuplicate, true);
  assert.equal(parse(post).allowDuplicate, false);
  for (const args of [['claim', '1', '--allow-duplicate'], ['list', '--allow-duplicate'], [...post, '--allow-duplicate=false']]) assert.throws(() => parse(args), CliError);
});
