/// <reference path="../../../vendor/agentguard/sdk-bridge.d.ts" />

import { parseNear, formatNear } from '@gitsettle/shared/format';
import type { Bounty } from '@gitsettle/shared/types';
import { assess, type RulesConfig } from '../../../vendor/agentguard/oracle/src/rules.js';
import type { SpendRequest } from '../../../vendor/agentguard/sdk/src/types.js';
import type { ReleaseGuard, ReleaseGuardDecision, VerificationDecision } from './types.js';

const REVIEW_AT = 35;
const DENY_AT = 70;
const MAX_CONTEXT_LENGTH = 100_000;
const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface AgentGuardConfig {
  enabled: boolean;
  maxPayoutYocto: string;
  deniedRecipients: string[];
  knownRecipients: string[];
}

function canonicalRecipient(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const account = trimmed.startsWith('near:') ? trimmed.slice(5) : trimmed;
  if (account.length < 2 || account.length > 64 || !NEAR_ACCOUNT.test(account)) {
    throw new Error('AgentGuard recipient settings must contain valid NEAR accounts or near:<account> values.');
  }
  return `near:${account}`;
}

/** Exact integer arithmetic; invalid configuration stops startup instead of weakening the limit. */
export function agentGuardConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentGuardConfig {
  const enabledValue = env.AGENTGUARD_ENABLED ?? 'true';
  if (!['true', 'false'].includes(enabledValue)) throw new Error('AGENTGUARD_ENABLED must be true or false.');
  let maxPayoutYocto: string;
  try { maxPayoutYocto = parseNear(env.AGENTGUARD_MAX_PAYOUT_NEAR ?? '5'); }
  catch { throw new Error('AGENTGUARD_MAX_PAYOUT_NEAR must be a positive decimal with at most 24 places.'); }
  if (BigInt(maxPayoutYocto) <= 0n || BigInt(maxPayoutYocto) > 1_000_000n * 10n ** 24n) {
    throw new Error('AGENTGUARD_MAX_PAYOUT_NEAR must be greater than zero and no more than 1000000.');
  }
  const recipients = (value?: string) => [...new Set((value ?? '').split(',').filter((entry) => entry.trim()).map(canonicalRecipient))];
  return {
    enabled: enabledValue === 'true', maxPayoutYocto,
    deniedRecipients: recipients(env.AGENTGUARD_DENIED_RECIPIENTS),
    knownRecipients: recipients(env.AGENTGUARD_KNOWN_RECIPIENTS),
  };
}

/**
 * Runs exact, pinned AgentGuard heuristics locally plus GitSettle's per-payout
 * cap. This is not the AgentGuard vault, a signed oracle verdict or a TEE. A hold
 * changes no contract state: the poster can inspect evidence and release manually.
 */
export class AgentGuardReleaseGuard implements ReleaseGuard {
  private readonly config: AgentGuardConfig;
  private readonly rules: RulesConfig;

  constructor(config: AgentGuardConfig = agentGuardConfigFromEnv({})) {
    // Revalidate programmatic callers too; monetary limits never use floating point.
    if (typeof config.enabled !== 'boolean') throw new Error('AgentGuard enabled must be an explicit boolean.');
    if (!/^[1-9][0-9]*$/.test(config.maxPayoutYocto) || BigInt(config.maxPayoutYocto) > 1_000_000n * 10n ** 24n) {
      throw new Error('AgentGuard maxPayoutYocto must be a positive integer within the contract reward bound.');
    }
    this.config = {
      ...config,
      deniedRecipients: config.deniedRecipients.map(canonicalRecipient),
      knownRecipients: config.knownRecipients.map(canonicalRecipient),
    };
    this.rules = {
      denylist: new Set(this.config.deniedRecipients), knownRecipients: this.config.knownRecipients,
      reviewAt: REVIEW_AT, denyAt: DENY_AT,
    };
  }

  evaluate(bounty: Bounty, evidence: Extract<VerificationDecision, { status: 'valid' }>): ReleaseGuardDecision {
    if (!this.config.enabled) {
      return { verdict: 'allow', score: 0, signalIds: [], message: 'AgentGuard local checks explicitly disabled by the operator.' };
    }
    const localSignals: { id: string; points: number }[] = [];
    if (!/^[1-9][0-9]*$/.test(bounty.reward)) localSignals.push({ id: 'invalid_reward', points: 1000 });
    else if (BigInt(bounty.reward) > BigInt(this.config.maxPayoutYocto)) localSignals.push({ id: 'gitsettle_payout_cap', points: REVIEW_AT });
    if (!bounty.claimant || bounty.status !== 'Submitted' || !Number.isSafeInteger(bounty.id) || bounty.id < 0) {
      localSignals.push({ id: 'invalid_submission_state', points: 1000 });
    }
    const bodyAvailable = typeof evidence.context === 'string' && evidence.context.length > 0;
    if (!bodyAvailable) localSignals.push({ id: 'missing_pr_context', points: REVIEW_AT });
    if (bodyAvailable && evidence.context.length > MAX_CONTEXT_LENGTH) localSignals.push({ id: 'oversized_pr_context', points: REVIEW_AT });
    const recipient = bounty.claimant ?? '';
    const request: SpendRequest = {
      token: 'near', amount: bounty.reward, recipient: `near:${recipient}`, pay_to: recipient,
      // Upstream's purpose-address regex does not understand full NEAR subaccounts.
      // Keep our deterministic purpose account-free; recipient lives in typed fields.
      purpose: `Release reward for verified GitSettle bounty ${bounty.id}`, nonce: bounty.id,
    };
    // Never truncate context then silently allow it: oversized/missing context is held.
    const context = bodyAvailable && evidence.context.length <= MAX_CONTEXT_LENGTH ? evidence.context : '';
    const assessment = assess(request, context, this.rules);
    const score = assessment.score + localSignals.reduce((sum, signal) => sum + signal.points, 0);
    const signalIds = [...new Set([...assessment.signals.map((signal) => signal.id), ...localSignals.map((signal) => signal.id)])];
    const verdict = score >= DENY_AT ? 'deny' : score >= REVIEW_AT ? 'review' : 'allow';
    const cap = `${formatNear(this.config.maxPayoutYocto)} NEAR`;
    const message = verdict === 'allow'
      ? `AgentGuard local checks passed (score ${score}; automatic payout cap ${cap}).`
      : `AgentGuard local ${verdict} (score ${score}): ${signalIds.join(', ')}.`
        + (signalIds.includes('gitsettle_payout_cap') ? ` Reward exceeds the ${cap} automatic payout cap.` : '')
        + ' Reward remains in escrow; the poster can review and release manually.';
    // Persist only this summary. Upstream details/context can contain untrusted prose.
    return { verdict, score, signalIds, message };
  }
}
