import type { Bounty } from './types.ts';
import { getMetadata, saveMetadata } from './db.ts';

const TTL_MS = 600_000;
const RETRY_MS = 60_000;
const CONCURRENCY = 3;
interface Work { key: string; namespace: string; bounty: Bounty }
interface QueueState { active: number; queued: Work[]; pending: Set<string>; attempted: Map<string, number> }
const processState = globalThis as typeof globalThis & { __gitsettleMetadataQueue?: QueueState };
const queue: QueueState = processState.__gitsettleMetadataQueue ??= { active: 0, queued: [], pending: new Set(), attempted: new Map() };

/** Descriptions are optional presentation data, so GitHub cannot delay escrow views. */
export function bountyMetadata(bounty: Bounty, namespace: string) {
  const metadata = getMetadata(bounty.id, namespace);
  const stale = !metadata || Date.now() - metadata.updatedAt > TTL_MS;
  const key = `${namespace}:${bounty.id}`;
  if (stale && !queue.pending.has(key) && Date.now() - (queue.attempted.get(key) ?? 0) > RETRY_MS && queue.queued.length < 500) {
    queue.pending.add(key);
    queue.queued.push({ key, namespace, bounty });
    drain();
  }
  return {
    title: metadata?.title || `Issue #${bounty.issue_url.split('/').pop()}`,
    description: metadata?.description || 'Read the linked GitHub issue for acceptance criteria and contribution details.',
    metadataUpdatedAt: metadata?.updatedAt ?? null,
    metadataStale: stale,
  };
}

/** Background tasks have bounded concurrency/timeouts and persist only successful metadata. */
function drain(): void {
  while (queue.active < CONCURRENCY && queue.queued.length) {
    const work = queue.queued.shift()!;
    queue.active += 1;
    queue.attempted.set(work.key, Date.now());
    while (queue.attempted.size > 1000) queue.attempted.delete(queue.attempted.keys().next().value!);
    void refresh(work.bounty, work.namespace).catch(() => { /* Retain known descriptions; never hide a chain view on metadata failure. */ }).finally(() => {
      queue.active -= 1; queue.pending.delete(work.key); drain();
    });
  }
}

async function refresh(bounty: Bounty, namespace: string): Promise<void> {
  const issue = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/([1-9][0-9]*)$/.exec(bounty.issue_url);
  if (!issue || issue[1] !== bounty.repo) return;
  const response = await fetch(`https://api.github.com/repos/${bounty.repo}/issues/${issue[2]}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'GitSettle/0.1 (CodeMasterLabs/gitsettle)' },
    signal: AbortSignal.timeout(4000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) return;
  const body = await response.json() as { title?: unknown; body?: unknown; pull_request?: unknown };
  if (body.pull_request || typeof body.title !== 'string' || !(typeof body.body === 'string' || body.body === null)) return;
  saveMetadata(bounty.id, body.title, body.body || 'Read the linked GitHub issue for acceptance criteria and contribution details.', namespace);
}
