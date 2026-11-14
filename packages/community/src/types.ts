/** Public response types contain no challenge cookie, session token, or signature. */
export interface AuthChallenge {
  challengeId: string;
  state: string;
  message: string;
  nonce: string;
  recipient: string;
  callbackUrl: string;
  expiresAt: string;
}
export interface CommunitySession { accountId: string; expiresAt: string; isAdmin: boolean }
export type TicketKind = 'appeal' | 'support';
export type TicketStatus = 'open' | 'in_review' | 'resolved';
export interface Ticket {
  id: string;
  kind: TicketKind;
  subject: string;
  bountyId: number | null;
  creatorAccount: string;
  posterAccount: string | null;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  permissions: { canReply: boolean; canReview: boolean; canResolve: boolean };
}
export interface TicketMessage { id: string; ticketId: string; authorAccount: string; body: string; createdAt: string }
export interface TicketDetail { ticket: Ticket; messages: TicketMessage[] }
