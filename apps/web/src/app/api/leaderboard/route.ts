import { leaderboardData, readModelHeaders } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET() {
  const startedAt = performance.now();
  try { const data = await leaderboardData(); return Response.json(data, { headers: readModelHeaders(data.updatedAt, startedAt) }); }
  catch { return Response.json({ error: 'The leaderboard could not be loaded. Try again.' }, { status: 503 }); }
}
