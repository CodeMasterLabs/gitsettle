'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useCommunity } from './community-provider';
import { useWallet } from './wallet-provider';
import type { TriageResult } from '@gitsettle/triage/types';

export type PreflightResult = TriageResult;

/** Deterministic checks and optional AI advice remain visible before funding. */
export function BountyPreflight({ result, loading, error, duplicateAccepted, onDuplicateAccepted, onCheck }: {
  result: PreflightResult | null; loading: boolean; error: string | null; duplicateAccepted: boolean;
  onDuplicateAccepted: (accepted: boolean) => void; onCheck: (useAi: boolean) => void;
}) {
  const { session, authenticate, status, error: authError } = useCommunity();
  const { accountId, connect, ready, config } = useWallet();
  return <section className="preflight-panel" aria-label="Bounty preflight checks"><h3><ShieldCheck size={17} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 7 }} aria-hidden="true" />Before you fund</h3>
    {loading && <p className="small-note" role="status">Checking for matching bounties and signals that need a closer look…</p>}
    {error && <div className="notice notice-error spaced-top" role="alert"><p>{error}</p></div>}
    {result && <><p className="small-note">{result.recommendation === 'duplicate' ? 'This issue already has a matching bounty. Review it before creating another reward.' : result.recommendation === 'review' ? 'Some checks need your attention. Review the details below before funding.' : 'No duplicate or spam signals were found by these checks. This is not a guarantee of work quality.'}</p>{result.signals.length > 0 && <ul className="preflight-signals">{result.signals.map((signal, index) => <li key={`${signal.code}-${index}`} className={`signal-${signal.severity}`}>{signal.message}</li>)}</ul>}{result.duplicateBountyIds.length > 0 && <><div className="preflight-matches">{result.duplicateBountyIds.map((id) => <Link key={id} href={`/bounties/${id}`} target="_blank">Review matching bounty #{id}</Link>)}</div><div className="check-row"><input id="duplicate-acknowledgement" type="checkbox" checked={duplicateAccepted} onChange={(event) => onDuplicateAccepted(event.target.checked)} /><label htmlFor="duplicate-acknowledgement">I reviewed the matching bounties and still want to fund this issue again.</label></div></>}
      <div className="preflight-ai"><h3>Optional AI review</h3>{result.aiError && <p className="field-error" role="alert">{result.aiError.message}</p>}{result.ai ? <><p>{result.ai.summary}</p>{result.ai.risks.length > 0 && <ul className="preflight-signals">{result.ai.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul>}{result.ai.suggestedActions.length > 0 && <ul className="preflight-signals">{result.ai.suggestedActions.map((action, index) => <li key={index}>{action}</li>)}</ul>}<p className="small-note spaced-top">AI advice is advisory. It cannot approve a payout or replace a maintainer’s review.</p></> : !result.aiConfigured ? <p>AI review is not enabled on this instance. The duplicate and spam checks above still run.</p> : <><p>Send this bounty’s public details to the host’s configured AI provider for an advisory review. Nothing is sent until you request it.</p>{session ? <button className="text-button" disabled={loading} onClick={() => onCheck(true)}>Request AI review</button> : accountId ? <button className="text-button" disabled={status === 'signing'} onClick={() => void authenticate()}>{status === 'signing' ? 'Waiting for wallet…' : 'Sign in to request AI review'}</button> : <button className="text-button" disabled={!ready || config?.mode === 'demo' || !config?.contractId} onClick={connect}>Connect wallet for AI review</button>}</>}{authError && <p className="field-error" role="alert">{authError}</p>}</div>
    </>}
    <button className="text-button" disabled={loading} onClick={() => onCheck(false)}>{result ? 'Run checks again' : 'Retry preflight checks'}</button>
    <p className="small-note">Checks use the current queue and may become stale before signing. Deliberate multiple rewards remain possible; the contract does not deduplicate issues.</p>
  </section>;
}
