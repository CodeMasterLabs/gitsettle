import { contributorData, readModelHeaders } from '@gitsettle/shared/data';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ account: string }> }) {
  const startedAt = performance.now();
  const { account } = await params;
  if (account.length < 2 || account.length > 64 || !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(account)) return Response.json({ error: 'Enter a valid NEAR account.' }, { status: 400 });
  try { const data = await contributorData(account); return Response.json(data, { headers: readModelHeaders(data.updatedAt, startedAt) }); }
  catch { return Response.json({ error: 'This contributor could not be loaded. Try again.' }, { status: 503 }); }
}
