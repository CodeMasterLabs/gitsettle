interface Entry { promise: Promise<unknown>; expiresAt: number }

/** Short-lived display cache. Authorization and transaction confirmation never use it.
 * Concurrent readers share one request. The TTL starts after a successful read;
 * composite values keep their older updatedAt boundary rather than extending it.
 * Failed reads are removed, and invalidated in-flight work cannot repopulate it.
 */
export class ReadModelCache {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now = Date.now, private readonly ttlMs = 5000, private readonly maxEntries = 128) {}
  get<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
    const cached = this.entries.get(key);
    if (!force && cached && cached.expiresAt > this.now()) return cached.promise as Promise<T>;
    const entry: Entry = { expiresAt: Number.POSITIVE_INFINITY, promise: Promise.resolve() };
    // Queue the loader after installing its entry so synchronous failures also
    // clear the correct request and concurrent callers can immediately coalesce.
    entry.promise = Promise.resolve().then(load).then(value => {
      if (this.entries.get(key) === entry) {
        const completedAt = this.now();
        const updatedAt = value && typeof value === 'object' && 'updatedAt' in value && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
          ? Math.min(completedAt, value.updatedAt) : completedAt;
        entry.expiresAt = updatedAt + this.ttlMs;
      }
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    return entry.promise as Promise<T>;
  }
  clear() { this.entries.clear(); }
}

// Next can bundle several API entry points separately. Share the display cache
// within this Node process without persisting monetary state in SQLite.
const state = globalThis as typeof globalThis & { __gitsettleReadModelCache?: ReadModelCache };
export const readModelCache = state.__gitsettleReadModelCache ??= new ReadModelCache();
