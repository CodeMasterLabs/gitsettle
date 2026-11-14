import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Bounty } from '@gitsettle/shared/types';
import { hashSecret } from './auth.ts';
import { badInput, boundedText, CommunityError, recordInput } from './errors.ts';
import type { CommunitySession, Ticket, TicketDetail, TicketKind, TicketMessage, TicketStatus } from './types.ts';

interface TicketRow {
  id: string; kind: TicketKind; subject: string; bounty_id: number | null;
  creator_account: string; poster_account: string | null; status: TicketStatus;
  created_at: number; updated_at: number; message_count: number;
}
interface MessageRow { id: string; ticket_id: string; author_account: string; body: string; created_at: number }
export interface TicketOptions {
  db: Database.Database;
  namespace: string;
  /** This MUST read the deployed contract at finalized state, never seeded demo data. */
  getBounty: (id: number) => Promise<Bounty | null>;
  now?: () => number;
}
const iso = (value: number) => new Date(value).toISOString();
const textHash = (text: string) => hashSecret(text.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim());

/** Private discussions have no contract signer and cannot mutate escrow or payout policy. */
export class CommunityTickets {
  private readonly now: () => number;
  constructor(private readonly options: TicketOptions) { this.now = options.now ?? Date.now; }

  list(viewer: CommunitySession): { tickets: Ticket[] } {
    const rows = this.options.db.prepare(`SELECT t.*, (SELECT count(*) FROM community_messages m WHERE m.ticket_id=t.id) AS message_count
      FROM community_tickets t WHERE namespace=? AND (?=1 OR creator_account=? OR poster_account=?)
      ORDER BY updated_at DESC,id DESC LIMIT 100`).all(this.options.namespace, Number(viewer.isAdmin), viewer.accountId, viewer.accountId) as TicketRow[];
    return { tickets: rows.map(row => this.toTicket(row, viewer)) };
  }

  detail(id: string, viewer: CommunitySession): TicketDetail {
    const ticket = this.accessible(id, viewer);
    const rows = this.options.db.prepare('SELECT id,ticket_id,author_account,body,created_at FROM community_messages WHERE namespace=? AND ticket_id=? ORDER BY created_at,rowid')
      .all(this.options.namespace, id) as MessageRow[];
    return { ticket: this.toTicket(ticket, viewer), messages: rows.map(this.toMessage) };
  }

  async create(input: unknown, viewer: CommunitySession): Promise<TicketDetail> {
    const value = recordInput(input);
    if (value.kind !== 'appeal' && value.kind !== 'support') badInput('Choose an appeal or a support ticket.');
    const kind = value.kind;
    const subject = boundedText(value.subject, 'Subject', 120);
    const body = boundedText(value.body, 'Message', 4000);
    let bountyId: number | null = null;
    let poster: string | null = null;
    if (kind === 'appeal') {
      if (typeof value.bountyId !== 'number' || !Number.isSafeInteger(value.bountyId) || value.bountyId < 0) badInput('An on-chain bounty ID is required for appeals.');
      bountyId = value.bountyId;
      let bounty: Bounty | null;
      try { bounty = await this.options.getBounty(bountyId); }
      catch { throw new CommunityError(503, 'near_unavailable', 'The contract could not confirm this appeal. Try again when the testnet connection recovers.'); }
      if (!bounty) throw new CommunityError(404, 'bounty_not_found', 'This bounty does not exist on the configured contract.');
      if (bounty.id !== bountyId || bounty.claimant !== viewer.accountId) throw new CommunityError(403, 'claimant_required', 'Only this bounty’s on-chain claimant can open an appeal.');
      if (bounty.status !== 'Submitted' && bounty.status !== 'Rejected') throw new CommunityError(409, 'appeal_unavailable', 'Appeals open after a PR is submitted or rejected.');
      poster = bounty.poster;
    } else if (value.bountyId !== undefined && value.bountyId !== null) {
      badInput('Choose appeal to attach a bounty. General support is private to you and support administrators.');
    }
    const { db, namespace } = this.options;
    const id = randomUUID();
    const now = this.now();
    db.transaction(() => {
      const count = db.prepare('SELECT count(*) AS count FROM community_tickets WHERE namespace=? AND creator_account=? AND created_at>?')
        .get(namespace, viewer.accountId, now - 3_600_000) as { count: number };
      if (count.count >= 3) throw new CommunityError(429, 'rate_limited', 'You can open three tickets per hour. Please continue an existing conversation.');
      if (kind === 'appeal' && db.prepare("SELECT id FROM community_tickets WHERE namespace=? AND bounty_id=? AND creator_account=? AND kind='appeal' AND status!='resolved'").get(namespace, bountyId, viewer.accountId)) {
        throw new CommunityError(409, 'appeal_exists', 'An open appeal already exists for this bounty. Continue that conversation.');
      }
      this.checkMessage(viewer.accountId, body, now);
      db.prepare('INSERT INTO community_tickets (id,namespace,kind,subject,bounty_id,creator_account,poster_account,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'open\',?,?)')
        .run(id, namespace, kind, subject, bountyId, viewer.accountId, poster, now, now);
      this.insertMessage(id, viewer.accountId, body, now);
    }).immediate();
    return this.detail(id, viewer);
  }

  reply(id: string, input: unknown, viewer: CommunitySession): TicketDetail {
    const body = boundedText(recordInput(input).body, 'Message', 4000);
    const { db } = this.options;
    db.transaction(() => {
      const ticket = this.accessible(id, viewer);
      if (ticket.status === 'resolved') throw new CommunityError(409, 'ticket_resolved', 'This conversation is resolved. Open a new support ticket if you need more help.');
      if (ticket.message_count >= 500) throw new CommunityError(409, 'thread_limit', 'This conversation has reached 500 messages. Open a follow-up support ticket.');
      const now = this.now();
      this.checkMessage(viewer.accountId, body, now);
      this.insertMessage(id, viewer.accountId, body, now);
    }).immediate();
    return this.detail(id, viewer);
  }

  update(id: string, input: unknown, viewer: CommunitySession): TicketDetail {
    const status = recordInput(input).status;
    if (status !== 'in_review' && status !== 'resolved') badInput('Choose in_review or resolved.');
    const { db, namespace } = this.options;
    db.transaction(() => {
      const ticket = this.accessible(id, viewer);
      const reviewer = viewer.isAdmin || viewer.accountId === ticket.poster_account;
      if (status === 'in_review' && !reviewer) throw new CommunityError(403, 'reviewer_required', 'Only support administrators or the bounty poster can mark an appeal in review.');
      if (ticket.status === 'resolved') throw new CommunityError(409, 'ticket_resolved', 'Resolved conversations cannot be reopened.');
      db.prepare('UPDATE community_tickets SET status=?,updated_at=? WHERE namespace=? AND id=?').run(status, this.now(), namespace, id);
    }).immediate();
    return this.detail(id, viewer);
  }

  private accessible(id: string, viewer: CommunitySession): TicketRow {
    const row = this.options.db.prepare(`SELECT t.*, (SELECT count(*) FROM community_messages m WHERE m.ticket_id=t.id) AS message_count
      FROM community_tickets t WHERE namespace=? AND id=?`).get(this.options.namespace, id) as TicketRow | undefined;
    // Deliberately identical response for nonexistent and unauthorized IDs to avoid enumeration.
    if (!row || (!viewer.isAdmin && row.creator_account !== viewer.accountId && row.poster_account !== viewer.accountId)) {
      throw new CommunityError(404, 'ticket_not_found', 'This conversation was not found.');
    }
    return row;
  }
  private toTicket(row: TicketRow, viewer: CommunitySession): Ticket {
    const active = row.status !== 'resolved';
    return { id: row.id, kind: row.kind, subject: row.subject, bountyId: row.bounty_id,
      creatorAccount: row.creator_account, posterAccount: row.poster_account, status: row.status,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), messageCount: row.message_count,
      permissions: { canReply: active, canReview: active && (viewer.isAdmin || row.poster_account === viewer.accountId), canResolve: active } };
  }
  private toMessage(row: MessageRow): TicketMessage {
    return { id: row.id, ticketId: row.ticket_id, authorAccount: row.author_account, body: row.body, createdAt: iso(row.created_at) };
  }
  /** Rate/duplicate checks and writes occur in one IMMEDIATE transaction across web processes. */
  private checkMessage(author: string, body: string, now: number): void {
    const { db, namespace } = this.options;
    const count = db.prepare('SELECT count(*) AS count FROM community_messages WHERE namespace=? AND author_account=? AND created_at>?')
      .get(namespace, author, now - 60_000) as { count: number };
    if (count.count >= 20) throw new CommunityError(429, 'rate_limited', 'You can send twenty messages per minute. Please wait before sending another.');
    if (db.prepare('SELECT id FROM community_messages WHERE namespace=? AND author_account=? AND body_hash=? AND created_at>?').get(namespace, author, textHash(body), now - 3_600_000)) {
      throw new CommunityError(409, 'repeated_text', 'You already sent that message recently. Add new information instead of repeating it.');
    }
  }
  private insertMessage(id: string, author: string, body: string, now: number): void {
    const { db, namespace } = this.options;
    db.prepare('INSERT INTO community_messages (id,ticket_id,namespace,author_account,body,body_hash,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), id, namespace, author, body, textHash(body), now);
    db.prepare('UPDATE community_tickets SET updated_at=? WHERE namespace=? AND id=?').run(now, namespace, id);
  }
}
