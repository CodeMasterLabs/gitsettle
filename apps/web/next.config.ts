import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// npm workspaces run in apps/web; native setup keeps the one ignored .env at
// the repository root. Explicitly exported process variables retain priority.
const repositoryRoot = resolve(process.cwd(), '../..');
const environmentFiles = new Set([resolve(repositoryRoot, '.env'), resolve(process.cwd(), '.env')]);
for (const file of environmentFiles) {
  if (!existsSync(file)) continue;
  const values = parseEnv(readFileSync(file, 'utf8'));
  for (const key of ['DEMO_MODE', 'NEAR_CONTRACT_ID', 'NEAR_RPC_URL', 'DATABASE_PATH', 'AGENTGUARD_ENABLED', 'AGENTGUARD_MAX_PAYOUT_NEAR', 'APP_ORIGIN', 'TRUST_PROXY_HEADERS', 'SUPPORT_ADMIN_ACCOUNTS', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
    if (process.env[key] === undefined && values[key] !== undefined) process.env[key] = values[key];
  }
}
process.env.DATABASE_PATH = resolve(repositoryRoot, process.env.DATABASE_PATH || 'data/gitsettle.sqlite');

const nextConfig: NextConfig = {
  transpilePackages: ['@gitsettle/shared', '@gitsettle/community', '@gitsettle/triage'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default nextConfig;
