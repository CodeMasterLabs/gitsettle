import assert from 'node:assert/strict';
import test from 'node:test';
import { NearCliPort } from './client.ts';
import { CliError, DEFAULT_CONTRACT, parseArgs } from './args.ts';

test('optional API reads require live testnet config for the selected contract and refuse redirects', async () => {
  const args = parseArgs(['list', '--api', 'https://gitsettle.example'], {});
  const urls: string[] = [];
  const port = new NearCliPort(args, true, async (url, options) => {
    urls.push(String(url)); assert.equal(options?.redirect, 'error'); assert.ok(options?.signal instanceof AbortSignal);
    return Response.json(String(url).endsWith('/api/config') ? { mode: 'testnet', network: 'testnet', contractId: DEFAULT_CONTRACT } : { bounties: [] });
  });
  await port.assertTestnet(); assert.deepEqual(await port.listBounties(), []); assert.deepEqual(urls, ['https://gitsettle.example/api/config', 'https://gitsettle.example/api/bounties']);
  for (const config of [{ mode: 'demo', network: 'testnet', contractId: DEFAULT_CONTRACT }, { mode: 'testnet', network: 'testnet', contractId: 'other.testnet' }]) {
    await assert.rejects(new NearCliPort(args, true, async () => Response.json(config)).assertTestnet(), CliError);
  }
});

test('API provider errors and oversized responses are bounded and never reflected', async () => {
  const args = parseArgs(['list', '--api', 'https://gitsettle.example'], {});
  for (const fetcher of [async () => new Response('SECRET', { status: 500 }), async () => new Response('x'.repeat(2_000_001)), async () => { throw new Error('SECRET'); }]) {
    await assert.rejects(new NearCliPort(args, true, fetcher).assertTestnet(), (error: unknown) => error instanceof CliError && !error.message.includes('SECRET'));
  }
});
