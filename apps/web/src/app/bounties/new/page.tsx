'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react';
import { BOUNTY_TYPES, type BoardData, type BountyType } from '@gitsettle/shared/types';
import { formatNear, parseNear } from '@gitsettle/shared/format';
import { dateLabel, useApi } from '@/lib/client';
import { DataError, PageHeading, PageSkeleton, TypeBadge, WalletNotice } from '@/components/ui';
import { useWallet } from '@/components/wallet-provider';

type Draft = { repo: string; issue: string; type: BountyType; locale: string; reward: string; deadline: string };
const DRAFT_KEY = 'gitsettle.bounty-draft.v1';
const blank: Draft = { repo: 'CodeMasterLabs/gitsettle', issue: '', type: 'Bug', locale: 'es', reward: '', deadline: '' };
const locales = [{ code: 'es', name: 'Spanish' }, { code: 'bn', name: 'Bengali' }, { code: 'ja', name: 'Japanese' }, { code: 'fr', name: 'French' }, { code: 'de', name: 'German' }, { code: 'pt-br', name: 'Brazilian Portuguese' }];

/** A two-step draft makes the exact irreversible deposit reviewable before opening a wallet. */
export default function PostBounty() {
  const { data, loading, error, retry } = useApi<BoardData>('/api/bounties');
  const { accountId, connect, ready, transact, transaction } = useWallet();
  const [draft, setDraft] = useState<Draft>(blank);
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState(1);
  const [customLocale, setCustomLocale] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const errorSummary = useRef<HTMLDivElement>(null);
  const reviewTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, unknown>;
        const restored = { ...blank };
        for (const key of Object.keys(blank) as (keyof Draft)[]) {
          if (typeof parsed[key] === 'string') Object.assign(restored, { [key]: parsed[key] });
        }
        if (!BOUNTY_TYPES.includes(restored.type)) restored.type = 'Bug';
        setDraft(restored); setCustomLocale(!locales.some((locale) => locale.code === restored.locale));
      } else {
        const due = new Date(Date.now() + 7 * 86_400_000);
        due.setMinutes(due.getMinutes() - due.getTimezoneOffset());
        setDraft((value) => ({ ...value, deadline: due.toISOString().slice(0, 16) }));
      }
    } catch { /* A damaged local draft is safe to discard; no chain state is involved. */ }
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }, [draft, hydrated]);
  useEffect(() => { if (Object.keys(errors).length) errorSummary.current?.focus(); }, [errors]);
  useEffect(() => { if (step === 2) reviewTitle.current?.focus(); }, [step]);
  useEffect(() => { if (transaction?.status === 'confirmed' && transaction.method === 'create_bounty') localStorage.removeItem(DRAFT_KEY); }, [transaction]);
  function update<K extends keyof Draft>(field: K, value: Draft[K]) { setDraft((previous) => ({ ...previous, [field]: value })); }
  function review(event: React.FormEvent) {
    event.preventDefault();
    const invalid: Record<string, string> = {};
    const repo = draft.repo.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || repo.length > 140) invalid.repo = 'Use a GitHub repository in owner/name format, up to 140 characters.';
    const issuePrefix = `https://github.com/${repo}/issues/`;
    if (!draft.issue.startsWith(issuePrefix) || !/^[1-9]\d{0,15}$/.test(draft.issue.slice(issuePrefix.length)) || draft.issue.length > 200) invalid.issue = 'Use the full GitHub issue URL from this repository, without a query string.';
    try { const amount = BigInt(parseNear(draft.reward)); if (amount <= 0n || amount > 1_000_000n * 10n ** 24n) invalid.reward = 'Enter a reward above zero and no greater than 1,000,000 NEAR.'; } catch { invalid.reward = 'Enter a decimal NEAR amount, such as 2.50, with up to 24 decimal places.'; }
    const deadline = new Date(draft.deadline).getTime();
    if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 366 * 86_400_000) invalid.deadline = 'Choose a future deadline within the next 366 days.';
    if (draft.type === 'Translation' && (!/^(?=[a-z]{2})[a-z0-9]{1,8}(?:-[a-z0-9]{1,8})*$/.test(draft.locale) || draft.locale.length < 2 || draft.locale.length > 16)) invalid.locale = 'Start the locale with two lowercase letters. Use 2–16 characters total and at most 8 per hyphen-separated part, such as es or pt-br.';
    setErrors(invalid);
    if (!Object.keys(invalid).length) { setDraft((value) => ({ ...value, repo })); setStep(2); window.scrollTo({ top: 0 }); }
  }
  async function fund() {
    if (!data || !accepted) return;
    const reward = parseNear(draft.reward);
    const deadline = Math.floor(new Date(draft.deadline).getTime() / 1000);
    if (deadline <= Date.now() / 1000) { setErrors({ deadline: 'The deadline has passed while you were reviewing. Choose a new deadline.' }); setStep(1); return; }
    await transact('create_bounty', { repo: draft.repo, issue_url: draft.issue, bounty_type: draft.type, target_locale: draft.type === 'Translation' ? draft.locale : null, reward, deadline }, (BigInt(reward) + BigInt(data.config.storage_reserve)).toString());
  }
  if (loading && !data) return <PageSkeleton rows={3} />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  if (transaction?.status === 'confirmed' && transaction.method === 'create_bounty' && transaction.bountyId !== undefined) return <>
    <PageHeading title="The reward is in escrow." description="Your bounty is funded and ready for a contributor to claim." />
    <div className="empty-state"><CheckCircle2 size={34} aria-hidden="true" /><h2>Bounty #{transaction.bountyId} is open.</h2><p>The reward is held by the NEAR contract. Share the bounty with developers and translators who can help.</p><Link className="button button-primary" href={`/bounties/${transaction.bountyId}`}>View funded bounty</Link></div>
  </>;
  let reward = '0';
  try { reward = parseNear(draft.reward || '0'); } catch { /* Review is gated by validation. */ }
  const total = (BigInt(reward) + BigInt(data.config.storage_reserve)).toString();
  const disabled = data.mode !== 'testnet' || !data.contractId || transaction?.status === 'pending';
  const fieldError = (field: string) => errors[field] ? <span className="field-error" id={`${field}-error`}>{errors[field]}</span> : null;
  return <>
    <Link href="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Back to work queue</Link>
    <PageHeading title="Fund the next contribution." description="Turn a clear GitHub issue into a reward someone can count on." />
    <WalletNotice purpose="fund the reward when your bounty is ready" />
    <ol className="form-steps" aria-label="Post a bounty steps"><li className={step === 1 ? 'current' : ''} aria-current={step === 1 ? 'step' : undefined}><span className="step-number">{step === 2 ? <Check size={13} aria-hidden="true" /> : '1'}</span>Describe the work</li><li className={step === 2 ? 'current' : ''} aria-current={step === 2 ? 'step' : undefined}><span className="step-number">2</span>Review & fund</li></ol>
    <div className="detail-layout form-layout"><div className="detail-main"><section className="content-panel">
      {Object.keys(errors).length > 0 && <div ref={errorSummary} tabIndex={-1} className="notice notice-error" role="alert"><p>Check the highlighted fields before continuing. {Object.values(errors)[0]}</p></div>}
      {step === 1 ? <form onSubmit={review} noValidate><h2>Start with the issue</h2><p className="form-intro">The linked issue is the source of scope and acceptance criteria. Use a public repository the verifier can read.</p>
        <div className="form-field"><label htmlFor="repo">GitHub repository</label><input id="repo" value={draft.repo} onChange={(event) => update('repo', event.target.value)} placeholder="CodeMasterLabs/gitsettle" required aria-invalid={Boolean(errors.repo)} aria-describedby={errors.repo ? 'repo-error' : undefined} />{fieldError('repo')}</div>
        <div className="form-field"><label htmlFor="issue">Issue URL</label><input id="issue" type="url" value={draft.issue} onChange={(event) => update('issue', event.target.value)} placeholder="https://github.com/CodeMasterLabs/gitsettle/issues/17" required aria-invalid={Boolean(errors.issue)} aria-describedby={errors.issue ? 'issue-error' : 'issue-help'} /><span className="field-help" id="issue-help">The app reads the issue title and description from GitHub.</span>{fieldError('issue')}</div>
        <div className="form-row"><div className="form-field"><label htmlFor="bounty-type">Work type</label><select id="bounty-type" value={draft.type} onChange={(event) => update('type', event.target.value as BountyType)}>{BOUNTY_TYPES.map((name) => <option key={name}>{name}</option>)}</select></div>
          {draft.type === 'Translation' && <div className="form-field"><label htmlFor="locale">Target locale</label><select id="locale" value={customLocale ? 'custom' : draft.locale} onChange={(event) => { setCustomLocale(event.target.value === 'custom'); update('locale', event.target.value === 'custom' ? '' : event.target.value); }}>{locales.map((locale) => <option value={locale.code} key={locale.code}>{locale.name} ({locale.code})</option>)}<option value="custom">Another locale…</option></select>{customLocale && <><label className="sr-only" htmlFor="locale-code">Custom locale code</label><input className="spaced-top" id="locale-code" value={draft.locale} onChange={(event) => update('locale', event.target.value.toLowerCase())} placeholder="For example, ar" aria-invalid={Boolean(errors.locale)} aria-describedby={errors.locale ? 'locale-error' : undefined} /></>}{fieldError('locale')}</div>}</div>
        <div className="form-row"><div className="form-field"><label htmlFor="reward">Reward (NEAR)</label><input id="reward" inputMode="decimal" value={draft.reward} onChange={(event) => update('reward', event.target.value)} placeholder="For example, 10.00" required aria-invalid={Boolean(errors.reward)} aria-describedby={errors.reward ? 'reward-error' : 'reward-help'} /><span className="field-help" id="reward-help">The contributor receives the full reward.</span>{fieldError('reward')}</div><div className="form-field"><label htmlFor="deadline">Submission deadline</label><input id="deadline" type="datetime-local" value={draft.deadline} onChange={(event) => update('deadline', event.target.value)} required aria-invalid={Boolean(errors.deadline)} aria-describedby={errors.deadline ? 'deadline-error' : 'deadline-help'} /><span className="field-help" id="deadline-help">Enter your local time. Review shows UTC.</span>{fieldError('deadline')}</div></div>
        <div className="form-actions"><span className="small-note">Draft saved in this browser.</span><button className="button button-primary" type="submit">Review bounty</button></div>
      </form> : <><h2 ref={reviewTitle} tabIndex={-1}>Review the escrow</h2><p className="form-intro">Confirm the work and exact deposit before opening your wallet. This creates a public bounty on NEAR Testnet.</p><dl className="review-list"><div><dt>Repository</dt><dd>{draft.repo}</dd></div><div><dt>Issue</dt><dd><a className="external-link" href={draft.issue} target="_blank" rel="noreferrer">#{draft.issue.split('/').at(-1)}</a></dd></div><div><dt>Work type</dt><dd><TypeBadge type={draft.type} locale={draft.type === 'Translation' ? draft.locale : null} /></dd></div><div><dt>Deadline</dt><dd>{dateLabel(new Date(draft.deadline).getTime() / 1000, true)}</dd></div><div><dt>Contributor reward</dt><dd className="tabular-nums">{formatNear(reward)} NEAR</dd></div><div><dt>Storage reserve</dt><dd className="tabular-nums">{formatNear(data.config.storage_reserve)} NEAR</dd></div><div className="review-total"><dt>Total deposit</dt><dd className="tabular-nums">{formatNear(total)} NEAR</dd></div></dl><p className="small-note spaced-top">The storage reserve is retained permanently. Your wallet also charges a small network gas fee. An unfulfilled reward can be refunded after the deadline if there is no pending valid submission.</p><div className="check-row"><input id="understand-escrow" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><label htmlFor="understand-escrow">I have reviewed the issue and understand that the verifier or my account can release this reward.</label></div><div className="form-actions"><button className="button button-quiet" onClick={() => setStep(1)}>Edit details</button>{accountId ? <button className="button button-primary" disabled={disabled || !accepted} onClick={() => void fund()}><LockKeyhole size={16} aria-hidden="true" />Fund escrow</button> : <button className="button button-primary" disabled={disabled || !ready} onClick={connect}><Wallet size={16} aria-hidden="true" />Connect to fund</button>}</div>{data.mode === 'demo' && <p className="small-note spaced-top">Funding is disabled while this instance is showing demo data.</p>}</>}
    </section></div><aside className="detail-aside"><div className="escrow-panel"><ShieldCheck size={25} color="var(--forest)" aria-hidden="true" /><h3 className="spaced-top">A clear path to settlement</h3><ol className="timeline spaced-top"><li><span className="timeline-icon">1</span><div><p>You fund the reward</p><small>Native NEAR stays in the contract.</small></div></li><li><span className="timeline-icon">2</span><div><p>A contributor claims the work</p><small>One account, one accountable submission.</small></div></li><li><span className="timeline-icon">3</span><div><p>The merged PR is verified</p><small>The reward is paid and points are credited.</small></div></li></ol></div><p className="trust-note">Only fund work with a clear acceptance criterion. The verifier checks GitHub evidence; it does not judge security, translation quality, or the value of the work.</p></aside></div>
  </>;
}
