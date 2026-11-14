import { handleCommunityRequest } from '@gitsettle/community/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, context: Context) => handleCommunityRequest(request, 'ticket', (await context.params).id);
export const PATCH = async (request: Request, context: Context) => handleCommunityRequest(request, 'ticket', (await context.params).id);
