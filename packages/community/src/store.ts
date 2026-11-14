import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** A separate WAL connection shares the existing database without changing other schemas. */
export function openCommunityStore(file: string): Database.Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_challenges (
      id TEXT PRIMARY KEY, namespace TEXT NOT NULL, browser_hash TEXT NOT NULL,
      account_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS community_challenge_account ON community_challenges(namespace,account_id,created_at);
    CREATE INDEX IF NOT EXISTS community_challenge_namespace_time ON community_challenges(namespace,created_at);
    CREATE TABLE IF NOT EXISTS community_sessions (
      token_hash TEXT PRIMARY KEY, namespace TEXT NOT NULL, account_id TEXT NOT NULL,
      public_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS community_tickets (
      id TEXT PRIMARY KEY, namespace TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('appeal','support')),
      subject TEXT NOT NULL, bounty_id INTEGER, creator_account TEXT NOT NULL,
      poster_account TEXT, status TEXT NOT NULL CHECK(status IN ('open','in_review','resolved')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_ticket_creator ON community_tickets(namespace,creator_account,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS community_open_appeal ON community_tickets(namespace,bounty_id,creator_account)
      WHERE kind='appeal' AND status != 'resolved';
    CREATE TABLE IF NOT EXISTS community_messages (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES community_tickets(id),
      namespace TEXT NOT NULL, author_account TEXT NOT NULL, body TEXT NOT NULL,
      body_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS community_message_account ON community_messages(namespace,author_account,created_at);
    CREATE INDEX IF NOT EXISTS community_message_ticket ON community_messages(ticket_id,created_at);
  `);
  return db;
}
