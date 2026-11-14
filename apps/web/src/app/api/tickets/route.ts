import { handleCommunityRequest } from '@gitsettle/community/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCommunityRequest(request, 'tickets');
export const POST = (request: Request) => handleCommunityRequest(request, 'tickets');
