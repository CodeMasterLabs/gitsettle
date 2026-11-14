import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmTransaction, type ConfirmationInput } from './transactions.ts';
import type { Bounty } from './types.ts';
const input: ConfirmationInput = { txHash: 't'.repeat(44), accountId: 'alice.testnet', method: 'release', bountyId: 1, expectedArgs: { id: 1 } };
function outcome(value: unknown = true) {
  return { final_execution_status: 'FINAL', transaction: { hash: input.txHash, signer_id: input.accountId, receiver_id: 'escrow.testnet', actions: [{ FunctionCall: { method_name: 'release', args: Buffer.from('{"id":1}').toString('base64') } }] }, status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString('base64') } };
}
const released = async () => ({ id: 1, status: 'Released' } as Bounty);
test('a wallet redirect requires final callback success and authoritative payout state', async () => {
  assert.equal((await confirmTransaction(input, 'escrow.testnet', outcome(), released)).status, 'confirmed');
  assert.equal((await confirmTransaction(input, 'escrow.testnet', outcome(false), released)).status, 'failed');
  assert.equal((await confirmTransaction(input, 'escrow.testnet', outcome(), async () => ({ id: 1, status: 'Submitted' } as Bounty))).status, 'pending');
  assert.equal((await confirmTransaction(input, 'escrow.testnet', { ...outcome(), final_execution_status: 'EXECUTED_OPTIMISTIC' }, released)).status, 'pending');
});
test('unrelated signer, receiver, method, bounty or arguments cannot confirm a wallet action', async () => {
  for (const update of [{ signer_id: 'mallory.testnet' }, { receiver_id: 'other.testnet' }, { hash: 'different' }, { actions: [] }]) {
    const result = outcome();
    Object.assign(result.transaction, update);
    assert.equal((await confirmTransaction(input, 'escrow.testnet', result, released)).status, 'failed');
  }
  assert.equal((await confirmTransaction({ ...input, bountyId: 2 }, 'escrow.testnet', outcome(), released)).status, 'failed');
  assert.equal((await confirmTransaction({ ...input, expectedArgs: { id: 1, extra: true } }, 'escrow.testnet', outcome(), released)).status, 'failed');
});
