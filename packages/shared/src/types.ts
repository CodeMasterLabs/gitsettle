/** JSON contract types. Currency remains decimal yoctoNEAR strings across every boundary. */
export type BountyType = 'Bug' | 'Feature' | 'Audit' | 'Translation' | 'Other';
export type BountyStatus = 'Open' | 'Claimed' | 'Submitted' | 'Rejected' | 'Releasing' | 'Released' | 'Refunding' | 'Refunded';
export interface Bounty {
  id: number; poster: string; repo: string; issue_url: string; bounty_type: BountyType;
  target_locale: string | null; reward: string; deadline: number; status: BountyStatus;
  claimant: string | null; pr_url: string | null; created_at: number; submitted_at: number | null;
  settled_at: number | null; rejection_reason: string | null;
}
export interface Contributor {
  account_id: string; points: number; merged_count: number; total_earned: string;
}
export interface ContractConfig {
  verifier: string; storage_reserve: string; bounty_count: number; points_per_merge: number; leaderboard_limit: number;
}
export interface VerificationRecord {
  bounty_id: number; outcome: 'pending' | 'rejected' | 'released' | 'error'; message: string;
  tx_hash?: string | null; checked_at?: number;
}
export interface BountyView extends Bounty {
  title: string; description: string; verification: VerificationRecord | null; expired: boolean;
}
export interface RankedContributor extends Contributor { rank: number; previous_rank: number | null; movement: number | null }
export interface PublicConfig {
  mode: 'demo' | 'testnet'; contractId: string | null; rpcUrl: string; network: 'testnet';
  automation?: { agentGuardEnabled: boolean; maxAutomaticPayoutYocto: string };
}
export interface BoardData extends PublicConfig { config: ContractConfig; bounties: BountyView[]; updatedAt: number }

export const BOUNTY_TYPES: BountyType[] = ['Bug', 'Feature', 'Audit', 'Translation', 'Other'];
export const STORAGE_RESERVE = '50000000000000000000000';
