import { leaderboardData } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json(await leaderboardData()); }
  catch { return Response.json({ error: 'The leaderboard could not be loaded. Try again.' }, { status: 503 }); }
}
