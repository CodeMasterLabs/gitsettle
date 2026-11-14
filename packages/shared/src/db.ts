import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { and, desc, eq, lt } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicConfig } from './near.ts';
import type { Contributor, RankedContributor, VerificationRecord } from './types.ts';

const metadata = sqliteTable('bounty_metadata', {
  key: text('key').primaryKey(), title: text('title').notNull(), description: text('description').notNull(), updatedAt: integer('updated_at').notNull(),
});
const verification = sqliteTable('verification_checks', {
  key: text('key').primaryKey(), payload: text('payload', { mode: 'json' }).$type<VerificationRecord>().notNull(),
});
const snapshots = sqliteTable('leaderboard_snapshots', {
  key: text('key').primaryKey(), namespace: text('namespace').notNull(), capturedAt: integer('captured_at').notNull(),
  entries: text('entries', { mode: 'json' }).$type<Contributor[]>().notNull(),
});

let database: ReturnType<typeof drizzle> | undefined;
/** Lazy connection keeps Next's build phase free of filesystem mutations. WAL supports two processes. */
export function getDatabase() {
  if (!database) {
    // Entry points normalize local paths; Docker supplies an absolute /data path.
    // Avoid build-time path resolution here: Next's file tracer must not treat the
    // configured database directory as application source to bundle into an image.
    const file = process.env.DATABASE_PATH || 'data/gitsettle.sqlite';
    mkdirSync(dirname(file), { recursive: true });
    const connection = new Database(file);
    connection.pragma('journal_mode = WAL');
    connection.pragma('busy_timeout = 5000');
    // Small, additive migration: run once per process, safely idempotent across web and worker.
    connection.exec(`
      CREATE TABLE IF NOT EXISTS bounty_metadata (key TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS verification_checks (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leaderboard_snapshots (key TEXT PRIMARY KEY, namespace TEXT NOT NULL, captured_at INTEGER NOT NULL, entries TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS snapshot_namespace_time ON leaderboard_snapshots(namespace, captured_at);
      PRAGMA user_version = 1;
    `);
    database = drizzle(connection);
  }
  return database;
}

/** Namespace isolation prevents demo rows or another deployment from contaminating live data. */
export function dataNamespace() {
  const config = publicConfig();
  return config.mode === 'demo' ? 'demo:v1' : `testnet:${config.contractId}`;
}

export function recordVerification(record: VerificationRecord) {
  const row = { key: `${dataNamespace()}:${record.bounty_id}`, payload: { ...record, checked_at: record.checked_at ?? Math.floor(Date.now() / 1000) } };
  getDatabase().insert(verification).values(row).onConflictDoUpdate({ target: verification.key, set: { payload: row.payload } }).run();
}
export function getVerification(id: number): VerificationRecord | null {
  return getDatabase().select().from(verification).where(eq(verification.key, `${dataNamespace()}:${id}`)).get()?.payload ?? null;
}
export function saveMetadata(id: number, title: string, description: string) {
  const row = { key: `${dataNamespace()}:${id}`, title: title.slice(0, 300), description: description.slice(0, 6000), updatedAt: Date.now() };
  getDatabase().insert(metadata).values(row).onConflictDoUpdate({ target: metadata.key, set: row }).run();
}
export function getMetadata(id: number) {
  return getDatabase().select().from(metadata).where(eq(metadata.key, `${dataNamespace()}:${id}`)).get() ?? null;
}

/** Compare against a real previous UTC-day snapshot; never invent rank movements. */
export function rankContributors(entries: Contributor[]): { entries: RankedContributor[]; snapshotAt: number | null } {
  const namespace = dataNamespace();
  const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  const previous = getDatabase().select().from(snapshots)
    .where(and(eq(snapshots.namespace, namespace), lt(snapshots.capturedAt, day)))
    .orderBy(desc(snapshots.capturedAt)).limit(1).get();
  getDatabase().insert(snapshots).values({ key: `${namespace}:${day}`, namespace, capturedAt: day, entries })
    .onConflictDoNothing().run();
  return {
    entries: entries.map((entry, index) => {
      const oldIndex = previous?.entries.findIndex(old => old.account_id === entry.account_id) ?? -1;
      return { ...entry, rank: index + 1, previous_rank: oldIndex < 0 ? null : oldIndex + 1, movement: oldIndex < 0 ? null : oldIndex - index };
    }),
    snapshotAt: previous?.capturedAt ?? null,
  };
}
