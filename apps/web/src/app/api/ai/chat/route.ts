import { handleAiChat } from '@gitsettle/triage/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleAiChat(request);
export const POST = (request: Request) => handleAiChat(request);
