import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATHS = ['/api/config', '/api/bounties', '/api/bounties/8', '/api/leaderboard'] as const;
const SAMPLE_COUNT = 5;
const BODY_LIMIT = 2 * 1024 * 1024;
const BOUNTY_STATES = new Set(['Open', 'Claimed', 'Submitted', 'Rejected', 'Releasing', 'Released', 'Refunding', 'Refunded']);
type Summary = Record<string, string | number | Record<string, number>>;
interface Sample {
  sample: number;
  status: number | null;
  headers_ms: number | null;
  total_ms: number;
  server_timing: Record<string, number>;
  summary: Summary | null;
  error?: 'timeout' | 'network_error' | 'invalid_json' | 'response_too_large';
}

function options(args: string[]) {
  let origin = process.env.APP_ORIGIN;
  let output: string | undefined;
  let timeoutMs = 15_000;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    const value = args[++index];
    if (!value || !['--origin', '--output', '--timeout-ms'].includes(flag)) throw new Error('Use --origin, --output, and optionally --timeout-ms.');
    if (flag === '--origin') origin = value;
    if (flag === '--output') output = resolve(value);
    if (flag === '--timeout-ms') timeoutMs = Number(value);
  }
  if (!origin) throw new Error('Set --origin or the public APP_ORIGIN environment variable.');
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('The origin must be a valid HTTPS or loopback HTTP URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
    throw new Error('Use an exact HTTPS origin, or loopback HTTP, without credentials, paths, queries, or fragments.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error('--timeout-ms must be between 1000 and 60000.');
  if (output && existsSync(output)) throw new Error('The output file already exists. Choose a new artifact path; existing measurements are preserved.');
  return { origin: url.origin, output, timeoutMs };
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

/** Explicitly exclude issue text, PR bodies, identities of requesters, cookies and tokens. */
function summarize(path: string, value: unknown): Summary | null {
  if (!object(value)) return null;
  const result: Summary = {};
  if (value.mode === 'testnet' || value.mode === 'demo') result.mode = value.mode;
  if (value.network === 'testnet') result.network = value.network;
  if (typeof value.contractId === 'string' && /^[a-z0-9._-]{2,64}$/.test(value.contractId)) result.contract_id = value.contractId;
  if (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)) result.snapshot_age_ms = Math.max(0, Date.now() - value.updatedAt);
  if (path === '/api/bounties' && Array.isArray(value.bounties)) {
    result.bounty_count = value.bounties.length;
    const statuses: Record<string, number> = {};
    for (const bounty of value.bounties) if (object(bounty) && typeof bounty.status === 'string' && BOUNTY_STATES.has(bounty.status)) statuses[bounty.status] = (statuses[bounty.status] || 0) + 1;
    result.bounty_statuses = statuses;
  }
  if (path === '/api/bounties/8' && object(value.bounty)) {
    if (Number.isSafeInteger(value.bounty.id)) result.bounty_id = value.bounty.id as number;
    if (typeof value.bounty.status === 'string' && BOUNTY_STATES.has(value.bounty.status)) result.bounty_status = value.bounty.status;
  }
  if (path === '/api/leaderboard' && Array.isArray(value.entries)) result.contributor_count = value.entries.length;
  return Object.keys(result).length ? result : null;
}

/** Keep only metric names and numeric durations; omit arbitrary header descriptions. */
function serverTiming(header: string | null): Record<string, number> {
  const timings: Record<string, number> = {};
  for (const metric of (header || '').slice(0, 2000).split(',')) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]{0,40})\s*;\s*dur=(\d+(?:\.\d+)?)(?:\s*;|\s*$)/.exec(metric);
    if (match && Number.isFinite(Number(match[2]))) timings[match[1]] = Number(match[2]);
  }
  return timings;
}

async function sample(origin: string, path: string, number: number, timeoutMs: number): Promise<Sample> {
  const started = performance.now();
  const record: Sample = { sample: number, status: null, headers_ms: null, total_ms: 0, server_timing: {}, summary: null };
  try {
    const response = await fetch(origin + path, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    record.status = response.status;
    record.headers_ms = Math.round(performance.now() - started);
    record.server_timing = serverTiming(response.headers.get('server-timing'));
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > BODY_LIMIT) { await reader.cancel(); record.error = 'response_too_large'; break; }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    if (!record.error) {
      try { record.summary = summarize(path, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { record.error = 'invalid_json'; }
    }
  } catch (error) {
    record.error = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network_error';
  }
  record.total_ms = Math.round(performance.now() - started);
  return record;
}

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

/** Read-only public API benchmark. This never loads .env files, credentials, or a signer. */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npx tsx scripts/measure-performance.ts --origin https://your-instance.example [--output /tmp/new-measurements.json] [--timeout-ms 15000]\nAPP_ORIGIN supplies the origin when --origin is omitted. Runs five sequential rounds over config, board, bounty #8 and leaderboard. No cookies, credentials, private routes, or transactions. Prints an allowlisted report; writes only when --output is explicit and never overwrites an existing artifact.');
    return;
  }
  const config = options(args);
  const startedAt = new Date().toISOString();
  const results = new Map<string, Sample[]>(PATHS.map(path => [path, []]));
  for (let number = 1; number <= SAMPLE_COUNT; number++) {
    for (const path of PATHS) results.get(path)!.push(await sample(config.origin, path, number, config.timeoutMs));
  }
  const endpoints = [...results].map(([path, samples]) => ({ path, median_ms: median(samples.map(row => row.total_ms)),
    min_ms: Math.min(...samples.map(row => row.total_ms)), max_ms: Math.max(...samples.map(row => row.total_ms)),
    successful_samples: samples.filter(row => row.status === 200 && !row.error).length, samples }));
  const report = { version: 1, origin: config.origin, started_at: startedAt, completed_at: new Date().toISOString(),
    method: 'Five sequential rounds; each round GETs config, board, bounty #8, leaderboard. First request may include DNS/TLS setup. No forced server cache reset; warm transport is reused. Times are diagnostic samples, not load-test percentiles.',
    sample_count_per_endpoint: SAMPLE_COUNT, timeout_ms: config.timeoutMs, transactions_sent: 0,
    all_healthy: endpoints.every(endpoint => endpoint.successful_samples === SAMPLE_COUNT), endpoints };
  if (config.output) { mkdirSync(dirname(config.output), { recursive: true }); writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  console.log(JSON.stringify(report, null, 2));
  if (!report.all_healthy) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'The performance measurement could not finish.'); process.exitCode = 1; });
}
