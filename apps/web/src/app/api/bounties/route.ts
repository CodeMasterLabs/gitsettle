import { boardData } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json(await boardData(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'The bounty queue could not be loaded. Check the testnet connection and try again.' }, { status: 503 }); }
}
