import { handleCommunityRequest } from '@gitsettle/community/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const POST = async (request: Request, context: Context) => handleCommunityRequest(request, 'messages', (await context.params).id);
