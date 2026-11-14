import type { Bounty } from '@gitsettle/shared/types';
import { GitHubApiError } from './github.js';
import type { AuditSink, ChainPort, PolicyPort, VerificationRecord } from './types.js';

export interface WorkerOptions {
  dryRun?: boolean;
  rejectInvalid?: boolean;
  now?: () => number;
}

/** Compare the immutable evidence snapshot immediately before a mutating transaction. */
function sameSubmission(before: Bounty, after: Bounty | null): after is Bounty {
  return after?.status === 'Submitted' && after.pr_url === before.pr_url
    && after.claimant === before.claimant && after.submitted_at === before.submitted_at;
}

/**
 * One serial worker per deployment. Contract states make retries safe after restarts;
 * the local guard prevents overlapping timer ticks and the oracle never holds user funds.
 */
export class VerifierWorker {
  private running = false;
  private pauseUntil = 0;
  private readonly lastAudit = new Map<number, string>();
  private readonly now: () => number;

  constructor(
    private readonly chain: ChainPort,
    private readonly policy: PolicyPort,
    private readonly audit: AuditSink,
    private readonly options: WorkerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  private async record(record: VerificationRecord) {
    const fingerprint = JSON.stringify([record.outcome, record.message, record.tx_hash ?? null]);
    if (this.lastAudit.get(record.bounty_id) === fingerprint) return;
    await this.audit({ ...record, checked_at: Math.floor(this.now() / 1000) });
    this.lastAudit.set(record.bounty_id, fingerprint);
  }

  /** Run one bounded, non-overlapping scan. API errors preserve every on-chain submission. */
  async tick(): Promise<{ inspected: number; skipped: boolean }> {
    if (this.running || this.now() < this.pauseUntil) return { inspected: 0, skipped: true };
    this.running = true;
    let inspected = 0;
    try {
      const bounties = await this.chain.listBounties();
      for (const bounty of bounties) {
        if (bounty.status !== 'Submitted') continue;
        inspected += 1;
        try {
          const decision = await this.policy.verify(bounty, this.chain.contractId);
          if (decision.status === 'pending') {
            await this.record({ bounty_id: bounty.id, outcome: 'pending', message: decision.message });
            continue;
          }
          if (this.options.dryRun) {
            await this.record({
              bounty_id: bounty.id, outcome: 'pending',
              message: `Dry run: ${decision.status === 'valid' ? 'eligible for payout' : 'invalid evidence'}. ${decision.message}`,
            });
            continue;
          }
          if (decision.status === 'invalid' && this.options.rejectInvalid === false) {
            await this.record({ bounty_id: bounty.id, outcome: 'pending', message: `Manual review required. ${decision.message}` });
            continue;
          }
          if (!sameSubmission(bounty, await this.chain.getBounty(bounty.id))) {
            await this.record({ bounty_id: bounty.id, outcome: 'pending', message: 'Submission changed during verification; the next scan will check fresh evidence.' });
            continue;
          }
          if (decision.status === 'invalid') {
            const result = await this.chain.reject(bounty.id, decision.message);
            const final = await this.chain.getBounty(bounty.id);
            if (final?.status !== 'Rejected') throw new Error('Rejection not finalized');
            await this.record({ bounty_id: bounty.id, outcome: 'rejected', message: decision.message, tx_hash: result.txHash });
            continue;
          }
          const result = await this.chain.release(bounty.id);
          const final = await this.chain.getBounty(bounty.id);
          if (final?.status !== 'Released') {
            await this.record({
              bounty_id: bounty.id, outcome: 'error', tx_hash: result.txHash,
              message: 'The payout has not reached Released on chain. The transfer callback controls payment and points; verification will retry.',
            });
            continue;
          }
          await this.record({ bounty_id: bounty.id, outcome: 'released', message: decision.message, tx_hash: result.txHash });
        } catch (error) {
          await this.record({
            bounty_id: bounty.id, outcome: 'error',
            message: error instanceof GitHubApiError ? error.message
              : 'Verification or NEAR settlement could not finish. On-chain state remains authoritative; the worker will retry.',
          });
          if (error instanceof GitHubApiError && (error.status === 403 || error.status === 429)) {
            // Respect the server's reset instead of hammering every bounty with a bad token/rate limit.
            this.pauseUntil = this.now() + Math.max(60_000, error.retryAfterMs ?? 60_000);
            break;
          }
        }
      }
      return { inspected, skipped: false };
    } finally {
      this.running = false;
    }
  }
}
