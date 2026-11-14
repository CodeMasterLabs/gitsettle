import { boardData } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) return Response.json({ error: 'Invalid bounty number.' }, { status: 400 });
  try {
    const { bounties, ...config } = await boardData();
    const bounty = bounties.find(row => row.id === Number(id));
    return bounty ? Response.json({ ...config, bounty }) : Response.json({ error: 'This bounty does not exist.' }, { status: 404 });
  } catch { return Response.json({ error: 'The bounty could not be loaded. Try again.' }, { status: 503 }); }
}
