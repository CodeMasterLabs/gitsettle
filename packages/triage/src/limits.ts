import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TriageError } from './types.ts';

/** A bounded in-process IP bucket; no model request is protected only by this limiter. */
export class PreflightLimiter {
  private buckets = new Map<string, { window: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  consume(key: string): void {
    const window = Math.floor(this.now() / 60_000);
    for (const [entry, bucket] of this.buckets) if (bucket.window !== window) this.buckets.delete(entry);
    if (!this.buckets.has(key) && this.buckets.size >= 2000) throw new TriageError(429, 'triage_busy', 'The preflight service is busy. Try again in a minute.', 60);
    const bucket = this.buckets.get(key) || { window, count: 0 };
    if (bucket.count >= 20) throw new TriageError(429, 'triage_rate_limit', 'Preflight allows 20 checks per minute. Try again shortly.', 60);
    bucket.count += 1; this.buckets.set(key, bucket);
  }
}

/** Proxy headers are trusted only when the operator explicitly enables its known proxy. */
export function requestRateKey(request: Request, trustProxy = process.env.TRUST_PROXY_HEADERS === 'true'): string {
  const forwarded = trustProxy ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
  const ip = forwarded && /^[a-fA-F0-9:.]{3,64}$/.test(forwarded) ? forwarded : 'direct-shared';
  return createHash('sha256').update(ip).digest('hex');
}

/** Small caches expire after five minutes and cannot grow with arbitrary request bodies. */
export class ExpiringCache<T> {
  private values = new Map<string, { expires: number; value: T }>();
  constructor(private readonly now: () => number = Date.now, private readonly capacity = 200) {}
  get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return;
    if (entry.expires <= this.now()) { this.values.delete(key); return; }
    return structuredClone(entry.value);
  }
  set(key: string, value: T) {
    if (!this.values.has(key) && this.values.size >= this.capacity) this.values.delete(this.values.keys().next().value!);
    this.values.set(key, { expires: this.now() + 300_000, value: structuredClone(value) });
  }
}

export interface AiQuota { consume(accountId: string): void }
/** Atomic persistent quota counts attempts, including provider failures that may have billed. */
export class SqliteAiQuota implements AiQuota {
  private db: Database.Database;
  constructor(file: string, private readonly namespace: string, private readonly now: () => number = Date.now) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS ai_daily_usage (namespace TEXT NOT NULL, account_id TEXT NOT NULL, day INTEGER NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY (namespace, account_id, day))');
  }
  consume(accountId: string): void {
    const day = Math.floor(this.now() / 86_400_000);
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT calls FROM ai_daily_usage WHERE namespace = ? AND account_id = ? AND day = ?').get(this.namespace, accountId, day) as { calls: number } | undefined;
      if ((row?.calls || 0) >= 20) throw new TriageError(429, 'ai_daily_quota', 'This wallet has used its 20 AI requests for today. Try again after 00:00 UTC.', Math.ceil(((day + 1) * 86_400_000 - this.now()) / 1000));
      this.db.prepare('INSERT INTO ai_daily_usage VALUES (?, ?, ?, 1) ON CONFLICT(namespace, account_id, day) DO UPDATE SET calls = calls + 1').run(this.namespace, accountId, day);
      this.db.prepare('DELETE FROM ai_daily_usage WHERE day < ?').run(day - 31);
    }).immediate();
  }
  close() { this.db.close(); }
}
