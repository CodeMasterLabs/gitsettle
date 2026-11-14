import { handleTriage } from '@gitsettle/triage/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const POST = (request: Request) => handleTriage(request);
