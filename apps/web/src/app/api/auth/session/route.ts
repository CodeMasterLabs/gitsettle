import { handleCommunityRequest } from '@gitsettle/community/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleCommunityRequest(request, 'session');
export const POST = (request: Request) => handleCommunityRequest(request, 'session');
export const DELETE = (request: Request) => handleCommunityRequest(request, 'session');
