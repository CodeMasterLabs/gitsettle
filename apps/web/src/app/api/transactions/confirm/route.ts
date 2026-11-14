import { getBounty, getProvider, publicConfig } from '@gitsettle/shared/near';
import { confirmTransaction, validConfirmationInput } from '@gitsettle/shared/transactions';
export const dynamic = 'force-dynamic';

/** This endpoint only reads NEAR. All signing happens in the user's selected wallet. */
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length')) > 12_000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 12_000) return Response.json({ error: 'Request too large.' }, { status: 413 });
    input = JSON.parse(body);
  } catch { return Response.json({ error: 'Invalid confirmation request.' }, { status: 400 }); }
  if (!validConfirmationInput(input)) return Response.json({ error: 'Invalid confirmation request.' }, { status: 400 });
  try {
    const config = publicConfig();
    if (config.mode !== 'testnet' || !config.contractId) return Response.json({ status: 'failed', txHash: input.txHash, message: 'Demo mode cannot confirm on-chain transactions.' }, { status: 409 });
    const result = await getProvider().viewTransactionStatus({ txHash: input.txHash, accountId: input.accountId, waitUntil: 'FINAL' });
    return Response.json(await confirmTransaction(input, config.contractId, result, getBounty));
  } catch {
    return Response.json({ status: 'pending', txHash: input.txHash, message: 'NEAR could not confirm the transaction yet. Check again shortly; do not repeat the payment.' });
  }
}
