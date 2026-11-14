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
  const failed = await confirmTransaction(input, 'escrow.testnet', outcome(false), released);
  assert.equal(failed.status, 'failed'); assert.equal(failed.verifiedAction, true);
  assert.equal((await confirmTransaction(input, 'escrow.testnet', outcome(), async () => ({ id: 1, status: 'Submitted' } as Bounty))).status, 'pending');
  assert.equal((await confirmTransaction(input, 'escrow.testnet', { ...outcome(), final_execution_status: 'EXECUTED_OPTIMISTIC' }, released)).status, 'pending');
});
test('unrelated signer, receiver, method, bounty or arguments cannot confirm a wallet action', async () => {
  for (const update of [{ signer_id: 'mallory.testnet' }, { receiver_id: 'other.testnet' }, { hash: 'different' }, { actions: [] }]) {
    const result = outcome();
    Object.assign(result.transaction, update);
    const confirmation = await confirmTransaction(input, 'escrow.testnet', result, released);
    assert.equal(confirmation.status, 'failed'); assert.equal(confirmation.verifiedAction, false);
    assert.match(confirmation.message, /original request remains unconfirmed/);
  }
  assert.equal((await confirmTransaction({ ...input, bountyId: 2 }, 'escrow.testnet', outcome(), released)).status, 'failed');
  assert.equal((await confirmTransaction({ ...input, expectedArgs: { id: 1, extra: true } }, 'escrow.testnet', outcome(), released)).status, 'failed');
});

test('only a fully matched FINAL transaction failure can clear the pending action', async () => {
  const failure = { ...outcome(), status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Rejected by contract' } } } } } };
  const final = await confirmTransaction(input, 'escrow.testnet', failure, released);
  assert.equal(final.status, 'failed'); assert.equal(final.verifiedAction, true);
  const optimistic = await confirmTransaction(input, 'escrow.testnet', { ...failure, final_execution_status: 'EXECUTED_OPTIMISTIC' }, released);
  assert.equal(optimistic.status, 'pending'); assert.notEqual(optimistic.verifiedAction, true);
  const missingFinality = await confirmTransaction(input, 'escrow.testnet', { ...failure, final_execution_status: undefined }, released);
  assert.equal(missingFinality.status, 'pending');
  const unrelated = { ...failure, transaction: { ...failure.transaction, hash: 'another-hash' } };
  assert.equal((await confirmTransaction(input, 'escrow.testnet', unrelated, released)).verifiedAction, false);
});

test('missing expected arguments cannot establish a safe retry even for a final failure', async () => {
  const withoutExpected = { ...input, expectedArgs: undefined };
  const failure = { ...outcome(), status: { Failure: { ActionError: { index: 0 } } } };
  for (const result of [failure, outcome(false)]) {
    const confirmation = await confirmTransaction(withoutExpected, 'escrow.testnet', result, released);
    assert.equal(confirmation.status, 'failed'); assert.equal(confirmation.verifiedAction, false);
    assert.match(confirmation.message, /original request remains unconfirmed/);
    assert.doesNotMatch(confirmation.message, /can retry|trying again/);
  }
});

test('unexpected transfer results and malformed success bytes stay ambiguous', async () => {
  for (const value of [null, 0, 'false', { success: false }]) {
    const confirmation = await confirmTransaction(input, 'escrow.testnet', outcome(value), released);
    assert.equal(confirmation.status, 'failed'); assert.equal(confirmation.verifiedAction, false);
  }
  const malformed = { ...outcome(), status: { SuccessValue: 'not valid base64' } };
  assert.equal((await confirmTransaction(input, 'escrow.testnet', malformed, released)).verifiedAction, false);
});

test('malformed argument JSON, non-object arguments, and multiple actions never prove a matching failure', async () => {
  for (const value of ['null', '[]', '1', 'invalid JSON']) {
    const result = outcome(false);
    result.transaction.actions[0].FunctionCall.args = Buffer.from(value).toString('base64');
    const confirmation = await confirmTransaction(input, 'escrow.testnet', result, released);
    assert.equal(confirmation.status, 'failed'); assert.equal(confirmation.verifiedAction, false);
  }
  const multiple = outcome(false);
  multiple.transaction.actions.push(multiple.transaction.actions[0]);
  assert.equal((await confirmTransaction(input, 'escrow.testnet', multiple, released)).verifiedAction, false);
});

test('malformed or contradictory FINAL failure evidence cannot release pending work', async () => {
  for (const status of [{ Failure: null }, { Failure: {} }, { Failure: 'error' }, { Failure: { error: true }, SuccessValue: 'ZmFsc2U=' }]) {
    const confirmation = await confirmTransaction(input, 'escrow.testnet', { ...outcome(), status }, released);
    assert.equal(confirmation.status, 'failed'); assert.equal(confirmation.verifiedAction, false);
  }
});
