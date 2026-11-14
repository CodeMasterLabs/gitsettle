/** A small navigation cache for public contract views only, never authenticated APIs. */
export class PublicViewCache {
  private readonly entries = new Map<string, { data?: unknown; expiresAt: number; pending?: Promise<unknown> }>();

  constructor(private readonly request: (url: string) => Promise<unknown>, private readonly now = Date.now) {}

  peek<T>(url: string): T | null {
    const entry = this.entries.get(url);
    return entry && entry.expiresAt > this.now() && entry.data !== undefined ? entry.data as T : null;
  }

  /** Invalidation detaches old in-flight reads so they cannot repopulate a newer cache. */
  invalidate(url?: string) {
    if (url) this.entries.delete(url);
    else this.entries.clear();
  }

  async read<T>(url: string): Promise<T> {
    if (!/^\/api\/(?:bounties(?:\/\d+)?|leaderboard|contributors\/[^/?#]+)$/.test(url)) {
      throw new Error('This cache accepts public contract views only.');
    }
    const existing = this.entries.get(url);
    if (existing?.pending) return existing.pending as Promise<T>;
    if (existing && existing.expiresAt > this.now() && existing.data !== undefined) return existing.data as T;
    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
    const entry: { data?: unknown; expiresAt: number; pending?: Promise<unknown> } = { expiresAt: 0 };
    this.entries.set(url, entry);
    const pending = this.request(url).then((data) => {
      if (this.entries.get(url) === entry) {
        entry.data = data;
        // Respect a server snapshot's age instead of stacking another five seconds
        // onto an already-aged response. Future timestamps never extend the cap.
        const snapshotAt = data && typeof data === 'object' && 'updatedAt' in data ? data.updatedAt : undefined;
        const age = typeof snapshotAt === 'number' && Number.isFinite(snapshotAt) ? Math.max(0, this.now() - snapshotAt) : 0;
        entry.expiresAt = this.now() + Math.max(0, 5_000 - age);
        entry.pending = undefined;
      }
      return data;
    }).catch((error: unknown) => {
      if (this.entries.get(url) === entry) this.entries.delete(url);
      throw error;
    });
    entry.pending = pending;
    return pending as Promise<T>;
  }
}
