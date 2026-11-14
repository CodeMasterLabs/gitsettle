import type { Bounty } from './types.ts';

export interface ConfirmationInput {
  txHash: string; accountId: string; method: string; bountyId?: number; expectedArgs?: Record<string, unknown>;
}
export interface Confirmation {
  status: 'pending' | 'confirmed' | 'failed'; message: string; txHash: string; bountyId?: number;
}
const methods = new Set(['create_bounty', 'claim_bounty', 'submit_pr', 'release', 'refund']);

/** Verify wallet-return hashes against the actual signer, receiver, method, arguments and final result. */
export async function confirmTransaction(
  input: ConfirmationInput,
  contractId: string,
  outcome: unknown,
  readBounty: (id: number) => Promise<Bounty | null>,
): Promise<Confirmation> {
  const base = { txHash: input.txHash };
  const fail = (message: string): Confirmation => ({ ...base, status: 'failed', message });
  const pending = (): Confirmation => ({ ...base, status: 'pending', message: 'NEAR is still confirming this transaction. Check again shortly.' });
  if (!methods.has(input.method)) return fail('Unsupported escrow action.');
  if (!outcome || typeof outcome !== 'object') return pending();
  const result = outcome as {
    final_execution_status?: string;
    transaction?: { hash?: string; signer_id?: string; receiver_id?: string; actions?: { FunctionCall?: { method_name?: string; args?: string } }[] };
    status?: { Failure?: unknown; SuccessValue?: string } | string;
  };
  const tx = result.transaction;
  if (!tx) return pending();
  if (tx.hash !== input.txHash || tx.signer_id !== input.accountId || tx.receiver_id !== contractId) return fail('The returned transaction does not match this wallet and escrow contract.');
  const action = tx.actions?.[0]?.FunctionCall;
  if (tx.actions?.length !== 1 || action?.method_name !== input.method) return fail('The returned transaction does not match the action you requested.');
  let actualArgs: Record<string, unknown>;
  try { actualArgs = JSON.parse(Buffer.from(action.args || '', 'base64').toString('utf8')) as Record<string, unknown>; }
  catch { return fail('The transaction arguments could not be verified.'); }
  if (input.bountyId !== undefined && actualArgs.id !== input.bountyId) return fail('The returned transaction belongs to a different bounty.');
  if (input.expectedArgs && canonicalJson(input.expectedArgs) !== canonicalJson(actualArgs)) return fail('The returned transaction arguments differ from the action you requested.');
  if (typeof result.status === 'object' && result.status && 'Failure' in result.status) return fail('The transaction failed on NEAR. Open it in the explorer for the contract error.');
  if (result.final_execution_status !== 'FINAL' || typeof result.status !== 'object' || !result.status || !('SuccessValue' in result.status)) return pending();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.status.SuccessValue || '', 'base64').toString('utf8')); }
  catch { return fail('The contract returned an unexpected confirmation.'); }
  if (input.method === 'release' || input.method === 'refund') {
    if (value !== true) return fail('The transfer failed. Funds remain in escrow; the authorized account can retry.');
    const id = input.bountyId ?? Number(actualArgs.id);
    const bounty = await readBounty(id);
    if (!bounty || bounty.status !== (input.method === 'release' ? 'Released' : 'Refunded')) return pending();
    return { ...base, bountyId: id, status: 'confirmed', message: input.method === 'release' ? 'Reward paid to the contributor.' : 'Reward returned to the poster.' };
  }
  const bounty = value as Bounty;
  if (!bounty || !Number.isSafeInteger(bounty.id)) return fail('The contract did not return a valid bounty.');
  const expectedStatus = { create_bounty: 'Open', claim_bounty: 'Claimed', submit_pr: 'Submitted' }[input.method];
  if (bounty.status !== expectedStatus) return fail('The contract returned an unexpected bounty state.');
  return { ...base, bountyId: bounty.id, status: 'confirmed', message: { create_bounty: 'Bounty funded. Your reward is held in escrow.', claim_bounty: 'Bounty claimed. You can now submit your pull request.', submit_pr: 'Pull request submitted for verification.' }[input.method]! };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validConfirmationInput(value: unknown): value is ConfirmationInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as ConfirmationInput;
  return typeof input.txHash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.txHash)
    && typeof input.accountId === 'string' && input.accountId.length >= 2 && input.accountId.length <= 64 && /^[a-z0-9._-]+$/.test(input.accountId)
    && methods.has(input.method)
    && (input.bountyId === undefined || (Number.isSafeInteger(input.bountyId) && input.bountyId >= 0))
    && (input.expectedArgs === undefined || (input.expectedArgs !== null && typeof input.expectedArgs === 'object' && !Array.isArray(input.expectedArgs)));
}
