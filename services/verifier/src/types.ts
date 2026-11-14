import type { Bounty } from '@gitsettle/shared/types';

/** A policy decision is separate from transport failures, which must never reject a claim. */
export type VerificationDecision =
  | { status: 'valid'; message: string; author: string; merge_sha: string; matching_files: string[] }
  | { status: 'pending' | 'invalid'; message: string };

/** On-chain mutations are injected so tests can prove when a payout is forbidden. */
export interface ChainPort {
  contractId: string;
  listBounties(): Promise<Bounty[]>;
  getBounty(id: number): Promise<Bounty | null>;
  release(id: number): Promise<{ txHash: string }>;
  reject(id: number, reason: string): Promise<{ txHash: string }>;
}

export interface PolicyPort {
  verify(bounty: Bounty, contractId: string): Promise<VerificationDecision>;
}

/** The audit store is a read model; these records never authorize money movement. */
export interface VerificationRecord {
  bounty_id: number;
  outcome: 'pending' | 'rejected' | 'released' | 'error';
  message: string;
  tx_hash?: string | null;
  checked_at?: number;
}

export type AuditSink = (record: VerificationRecord) => void | Promise<void>;
