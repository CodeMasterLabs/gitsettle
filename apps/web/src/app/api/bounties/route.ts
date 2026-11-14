import { boardData, readModelHeaders } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET() {
  const startedAt = performance.now();
  try { const data = await boardData(); return Response.json(data, { headers: readModelHeaders(data.updatedAt, startedAt) }); }
  catch { return Response.json({ error: 'The bounty queue could not be loaded. Check the testnet connection and try again.' }, { status: 503 }); }
}
