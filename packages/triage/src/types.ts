import type { BountyType } from '@gitsettle/shared/types';

export type SignalSeverity = 'info' | 'warning' | 'high';
export interface TriageSignal { code: string; severity: SignalSeverity; message: string }
export interface TriageCandidate {
  repo: string; issue_url: string; bounty_type: BountyType; target_locale: string | null;
  text: string; useAi: boolean;
}
export interface AiReview { summary: string; risks: string[]; suggestedActions: string[] }
export interface TriageResult {
  duplicateBountyIds: number[];
  signals: TriageSignal[];
  recommendation: 'ready' | 'review' | 'duplicate';
  aiConfigured: boolean;
  ai?: AiReview;
  aiError?: { code: string; message: string };
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatInput { message: string; history: ChatMessage[]; bountyId?: number }
export interface IssueEvidence { state: 'open' | 'closed' | 'unavailable'; title?: string; body?: string; isPullRequest?: boolean }

/** Only explicit safe messages cross the HTTP boundary; upstream errors never do. */
export class TriageError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter?: number) { super(message); }
}
