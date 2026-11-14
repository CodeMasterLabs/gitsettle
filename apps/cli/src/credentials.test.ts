import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from 'near-api-js';
import { CliError, parseArgs } from './args.ts';
import { loadCredential } from './credentials.ts';

test('signing keys come from environment without entering parsed arguments', () => {
  const key = KeyPair.fromRandom('ed25519').toString();
  const env = { GITSETTLE_ACCOUNT_ID: 'alice.testnet', GITSETTLE_PRIVATE_KEY: key };
  const args = parseArgs(['claim', '1', '--yes'], env);
  assert.ok(!JSON.stringify(args).includes(key)); assert.equal(loadCredential(args, env).privateKey, key);
  assert.throws(() => loadCredential(args, {}), CliError);
  assert.throws(() => loadCredential(args, { GITSETTLE_PRIVATE_KEY: 'bad-private-secret' }), (error: unknown) => error instanceof CliError && !error.message.includes('bad-private-secret'));
});

test('wallet files require ownership, exact 0600 mode, safe JSON, and matching testnet account', t => {
  const directory = mkdtempSync(join(tmpdir(), 'gitsettle-cli-wallet-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'wallet.json'); const key = KeyPair.fromRandom('ed25519').toString();
  writeFileSync(file, JSON.stringify({ account_id: 'alice.testnet', private_key: key }), { mode: 0o600 });
  const args = parseArgs(['claim', '1', '--wallet', file], {});
  assert.equal(loadCredential(args, {}).accountId, 'alice.testnet');
  assert.throws(() => loadCredential({ ...args, accountId: 'bob.testnet' }, {}), CliError);
  chmodSync(file, 0o644); assert.throws(() => loadCredential(args, {}), CliError); chmodSync(file, 0o600);
  const linked = join(directory, 'linked.json'); symlinkSync(file, linked); assert.throws(() => loadCredential({ ...args, walletFile: linked }, {}), CliError);
  writeFileSync(file, '{bad-json-secret'); assert.throws(() => loadCredential(args, {}), (error: unknown) => error instanceof CliError && !error.message.includes('bad-json-secret'));
  writeFileSync(file, JSON.stringify({ accountId: 'alice.testnet', account_id: 'bob.testnet', privateKey: key })); assert.throws(() => loadCredential(args, {}), CliError);
});
