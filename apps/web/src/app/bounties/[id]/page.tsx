'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, Clock3, Copy, GitMerge, GitPullRequest, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { BountyView, ContractConfig, PublicConfig } from '@gitsettle/shared/types';
import { formatNear, isExpired } from '@gitsettle/shared/format';
import { dateLabel, issueNumber, useApi } from '@/lib/client';
import { DataError, ExternalLink, PageSkeleton, StatusBadge, TypeBadge, WalletNotice } from '@/components/ui';
import { useWallet } from '@/components/wallet-provider';

type DetailData = PublicConfig & { config: ContractConfig; bounty: BountyView };

function SubmissionForm({ bounty, contractId }: { bounty: BountyView; contractId: string }) {
  const { transact, transaction } = useWallet();
  const [prUrl, setPrUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const marker = `GitSettle: ${contractId}/${bounty.id}/${bounty.claimant}`;
  const instructions = `Closes ${bounty.issue_url}\n${marker}`;
  useEffect(() => { setPrUrl(sessionStorage.getItem(`gitsettle.pr.${bounty.id}`) || bounty.pr_url || ''); }, [bounty.id, bounty.pr_url]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const prefix = `https://github.com/${bounty.repo}/pull/`;
    if (!prUrl.startsWith(prefix) || !/^[1-9]\d{0,15}$/.test(prUrl.slice(prefix.length))) { setError(`Use a canonical pull request URL from ${bounty.repo}, with no query string.`); return; }
    await transact('submit_pr', { id: bounty.id, pr_url: prUrl });
  }
  return <section className="content-panel" aria-labelledby="submit-heading"><h2 id="submit-heading">Submit your pull request</h2><p className="form-intro">Add these two lines to the pull request description before submitting. The author’s description binds this work to your wallet.</p><code className="proof-code">{instructions}</code><button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(instructions); setCopied(true); } catch { setError('Copy the two lines above into the pull request description.'); } }}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied instructions' : 'Copy instructions'}</button>
    {bounty.target_locale && <p className="small-note spaced-top">Translation work must change a file for <strong>{bounty.target_locale}</strong>, such as <code>locales/{bounty.target_locale}/messages.json</code> or <code>src/i18n/{bounty.target_locale}.json</code>. A deleted-only file does not qualify.</p>}
    <form onSubmit={submit} className="spaced-top"><div className="form-field"><label htmlFor="pr-url">Pull request URL</label><input id="pr-url" type="url" required value={prUrl} placeholder={`https://github.com/${bounty.repo}/pull/123`} onChange={(event) => { setPrUrl(event.target.value); sessionStorage.setItem(`gitsettle.pr.${bounty.id}`, event.target.value); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'pr-error' : 'pr-help'} /><span className="field-help" id="pr-help">Submit before the bounty deadline. Settlement waits until the pull request is merged.</span>{error && <span className="field-error" role="alert" id="pr-error">{error}</span>}</div><button className="button button-primary" disabled={transaction?.status === 'pending'} type="submit"><GitPullRequest size={16} aria-hidden="true" />{bounty.status === 'Rejected' ? 'Resubmit pull request' : 'Submit for verification'}</button></form>
  </section>;
}

export default function BountyDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, retry } = useApi<DetailData>(`/api/bounties/${encodeURIComponent(id)}`);
  const { accountId, connect, ready, transact, transaction } = useWallet();
  if (loading && !data) return <PageSkeleton rows={3} />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  const bounty = data.bounty;
  const expired = isExpired(bounty);
  const isPoster = accountId === bounty.poster;
  const isClaimant = accountId === bounty.claimant;
  const canSubmit = isClaimant && ['Claimed', 'Rejected'].includes(bounty.status) && !expired && data.mode === 'testnet';
  const busy = transaction?.status === 'pending';
  const enabled = data.mode === 'testnet' && Boolean(data.contractId);
  let action: React.ReactNode = null;
  let actionHint = '';
  if (bounty.status === 'Released') {
    action = <div className="success-note"><CheckCircle2 size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} aria-hidden="true" />Reward settled</div>;
    actionHint = `Paid to ${bounty.claimant}. ${data.config.points_per_merge} contribution points credited.`;
  } else if (bounty.status === 'Refunded') {
    action = <strong>Escrow refunded</strong>; actionHint = 'The reward was returned to the bounty poster. The storage reserve is retained by the contract.';
  } else if (['Releasing', 'Refunding'].includes(bounty.status)) {
    action = <strong>Settlement in progress</strong>; actionHint = 'NEAR is processing the transfer. This view refreshes automatically.';
  } else if (expired && isPoster) {
    action = <button className="button button-quiet button-full" disabled={!enabled || busy} onClick={() => void transact('refund', { id: bounty.id })}>Refund reward</button>; actionHint = 'The deadline passed with no valid submission. The storage reserve is not refunded.';
  } else if (expired) {
    action = <strong>Deadline passed</strong>; actionHint = 'This bounty is no longer accepting claims or submissions. The poster can refund the reward.';
  } else if (bounty.status === 'Submitted' && isPoster) {
    action = <button className="button button-primary button-full" disabled={!enabled || busy} onClick={() => void transact('release', { id: bounty.id })}>Approve & release reward</button>; actionHint = 'Approval pays the claimant immediately, without waiting for the verifier. Review the linked work first.';
  } else if (bounty.status === 'Submitted') {
    action = <strong>Waiting for verification</strong>; actionHint = 'The verifier checks merge, repository, issue reference, account binding, and any locale requirement.';
  } else if (bounty.status === 'Open' && !accountId) {
    action = <button className="button button-primary button-full" disabled={!enabled || !ready} onClick={connect}>Connect wallet to claim</button>; actionHint = 'A NEAR Testnet wallet is required. The full reward goes to the accepted contributor.';
  } else if (bounty.status === 'Open' && isPoster) {
    action = <strong>Open for contributors</strong>; actionHint = 'You posted this bounty. Another account can claim the work before the deadline.';
  } else if (bounty.status === 'Open') {
    action = <button className="button button-primary button-full" disabled={!enabled || busy} onClick={() => void transact('claim_bounty', { id: bounty.id })}>Claim this bounty</button>; actionHint = 'Claiming reserves the work for your account until the deadline. No deposit is required.';
  } else if (isClaimant) {
    action = <a className="button button-primary button-full" href="#submit-heading">Submit your pull request</a>; actionHint = 'This work is claimed by your account. Add the proof lines and submit before the deadline.';
  } else {
    action = <strong>Work is in progress</strong>; actionHint = `Claimed by ${bounty.claimant}. Browse the queue to find open work.`;
  }
  return <>
    <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Back to work queue</Link>
    <div className="detail-heading"><div className="detail-tags"><TypeBadge type={bounty.bounty_type} locale={bounty.target_locale} /><StatusBadge bounty={bounty} /></div><h1>{bounty.title}</h1><div className="issue-meta"><ExternalLink href={bounty.issue_url}>{bounty.repo} #{issueNumber(bounty.issue_url)}</ExternalLink></div></div>
    <WalletNotice purpose="claim this bounty or manage your submission" />
    <div className="detail-layout"><div className="detail-main">
      <section className="content-panel"><h2>The work</h2><p className="body-copy">{bounty.description || 'Read the linked GitHub issue for the scope and acceptance criteria.'}</p><div className="spaced-top"><ExternalLink href={bounty.issue_url}>Read the issue on GitHub</ExternalLink></div>{bounty.target_locale && <><div className="section-divider" /><h3>Translation scope</h3><p className="small-note spaced-top">Target locale <span className="locale-badge">{bounty.target_locale}</span>. The merged pull request must add or modify a file in a matching locale/i18n path. The verifier checks paths; the maintainer remains responsible for language quality.</p></>}</section>
      {bounty.verification && <section className="content-panel"><h2>Verification check</h2><p className={bounty.verification.outcome === 'released' ? 'success-note' : 'body-copy'}>{bounty.verification.message}</p>{bounty.verification.checked_at && <p className="small-note spaced-top">Last checked {dateLabel(bounty.verification.checked_at, true)}</p>}{bounty.verification.tx_hash && <div className="spaced-top"><ExternalLink href={`https://testnet.nearblocks.io/txns/${bounty.verification.tx_hash}`}>View settlement transaction</ExternalLink></div>}</section>}
      {bounty.status === 'Rejected' && bounty.rejection_reason && <div className="notice notice-error" role="alert"><p><strong>Submission needs changes.</strong> {bounty.rejection_reason}</p></div>}
      {canSubmit && data.contractId && <SubmissionForm bounty={bounty} contractId={data.contractId} />}
      <section className="content-panel"><h2>Contribution timeline</h2><ol className="timeline">
        <li><span className="timeline-icon"><LockKeyhole size={12} aria-hidden="true" /></span><div><p>Reward {data.mode === 'demo' ? 'shown as example' : 'funded in escrow'}</p><small>{dateLabel(bounty.created_at, true)}</small></div></li>
        {bounty.claimant && <li><span className="timeline-icon"><Check size={12} aria-hidden="true" /></span><div><p>Claimed by <Link className="external-link" href={`/contributors/${encodeURIComponent(bounty.claimant)}`}>{bounty.claimant}</Link></p></div></li>}
        {bounty.pr_url && <li><span className="timeline-icon"><GitPullRequest size={12} aria-hidden="true" /></span><div><p><ExternalLink href={bounty.pr_url}>Pull request submitted</ExternalLink></p>{bounty.submitted_at && <small>{dateLabel(bounty.submitted_at, true)}</small>}</div></li>}
        {bounty.status === 'Released' && <li><span className="timeline-icon"><GitMerge size={12} aria-hidden="true" /></span><div><p>Reward paid and reputation credited</p>{bounty.settled_at && <small>{dateLabel(bounty.settled_at, true)}</small>}</div></li>}
        {bounty.status === 'Refunded' && <li><span className="timeline-icon"><Check size={12} aria-hidden="true" /></span><div><p>Reward returned to poster</p>{bounty.settled_at && <small>{dateLabel(bounty.settled_at, true)}</small>}</div></li>}
        {!['Released', 'Refunded'].includes(bounty.status) && <li><span className="timeline-icon"><Clock3 size={12} aria-hidden="true" /></span><div><p>{expired ? 'Submission deadline passed' : 'Submission deadline'}</p><small>{dateLabel(bounty.deadline, true)}</small></div></li>}
      </ol></section>
    </div><aside className="detail-aside" aria-label="Escrow and actions"><div className="escrow-panel"><div className="reward-label">Bounty reward</div><div className="escrow-amount tabular-nums">{formatNear(bounty.reward)} <span>NEAR</span></div><p className="escrow-promise"><ShieldCheck size={17} aria-hidden="true" />{data.mode === 'demo' ? 'Example reward. No funds are held.' : bounty.status === 'Released' ? 'Reward paid to the contributor.' : bounty.status === 'Refunded' ? 'Reward returned to the poster.' : 'Reward held in escrow until merge.'}</p>{action}<p className="action-hint">{actionHint}</p><div className="section-divider" /><dl className="detail-info"><div><dt>Deadline</dt><dd className="tabular-nums">{dateLabel(bounty.deadline, true)}</dd></div><div><dt>Posted by</dt><dd><Link href={`/contributors/${encodeURIComponent(bounty.poster)}`}>{bounty.poster}</Link></dd></div>{bounty.claimant && <div><dt>Contributor</dt><dd><Link href={`/contributors/${encodeURIComponent(bounty.claimant)}`}>{bounty.claimant}</Link></dd></div>}<div><dt>Reputation on settlement</dt><dd className="tabular-nums">+{data.config.points_per_merge} points</dd></div></dl></div><p className="trust-note"><strong>A trusted verifier checks GitHub.</strong> The bounty poster can also release the reward. There is no dispute court or automatic review of code quality. <ExternalLink href="https://github.com/CodeMasterLabs/gitsettle#trust-model-and-limitations">Read the trust model</ExternalLink></p></aside></div>
  </>;
}
