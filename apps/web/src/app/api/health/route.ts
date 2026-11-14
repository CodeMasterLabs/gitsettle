import { getDatabase } from '@gitsettle/shared/db';
export const dynamic = 'force-dynamic';
/** A local readiness check. RPC/GitHub outages should not restart otherwise healthy containers. */
export function GET() {
  try { getDatabase(); return Response.json({ status: 'ok', service: 'gitsettle-web' }); }
  catch { return Response.json({ status: 'error', message: 'Database unavailable.' }, { status: 503 }); }
}
