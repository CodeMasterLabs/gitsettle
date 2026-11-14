import { publicConfig } from '@gitsettle/shared/near';
export const dynamic = 'force-dynamic';
export function GET() {
  try { return Response.json(publicConfig()); }
  catch { return Response.json({ error: 'Testnet escrow is not configured correctly. Check the instance environment.' }, { status: 503 }); }
}
