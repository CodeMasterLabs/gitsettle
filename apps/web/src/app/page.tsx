'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowUpRight, Blocks, Bug, CircleCheck, GitMerge, Languages, LayoutList, LockKeyhole, Plus, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { BOUNTY_TYPES, type BoardData } from '@gitsettle/shared/types';
import { formatNear, isExpired, parseNear } from '@gitsettle/shared/format';
import { useApi } from '@/lib/client';
import { BountyQueue, DataError, PageHeading, PageSkeleton, WalletNotice } from '@/components/ui';

export default function WorkQueue() {
  const { data, error, loading, retry } = useApi<BoardData>('/api/bounties');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [minimum, setMinimum] = useState('');
  const [sort, setSort] = useState('newest');
  useEffect(() => { setSearch(new URLSearchParams(window.location.search).get('q') || ''); }, []);
  let rewardFilterError = false;
  try { if (minimum) parseNear(minimum); } catch { rewardFilterError = true; }
  const filtered = useMemo(() => {
    if (!data) return [];
    let min = 0n;
    try { min = minimum ? BigInt(parseNear(minimum)) : 0n; } catch { /* Incomplete input keeps the unfiltered list visible. */ }
    return data.bounties.filter((bounty) => {
      const text = `${bounty.title} ${bounty.repo} ${bounty.target_locale || ''} ${bounty.description}`.toLowerCase();
      const derivedStatus = isExpired(bounty) ? 'Expired' : bounty.status;
      return text.includes(search.toLowerCase()) && (type === 'all' || bounty.bounty_type === type)
        && (status === 'all' || derivedStatus === status) && BigInt(bounty.reward) >= min;
    }).sort((a, b) => sort === 'reward' ? (BigInt(a.reward) > BigInt(b.reward) ? -1 : BigInt(a.reward) < BigInt(b.reward) ? 1 : b.id - a.id) : sort === 'deadline' ? a.deadline - b.deadline : b.id - a.id);
  }, [data, search, type, status, minimum, sort]);
  function reset() { setSearch(''); setType('all'); setStatus('all'); setMinimum(''); }
  const heading = <div className="board-heading"><PageHeading title="Work queue" description="Find your next contribution. The reward is already here." action={<Link className="button button-primary" href="/bounties/new"><Plus size={17} aria-hidden="true" />Post a bounty</Link>} /></div>;
  if (loading && !data) return <>{heading}<PageSkeleton hideHeading /></>;
  if (error && !data) return <>{heading}<DataError error={error} retry={retry} /></>;
  if (!data) return null;
  const open = data.bounties.filter((bounty) => bounty.status === 'Open' && !isExpired(bounty));
  const held = data.bounties.filter((bounty) => !['Released', 'Refunded'].includes(bounty.status)).reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n);
  const inReview = data.bounties.filter((bounty) => bounty.status === 'Submitted').length;
  const locales = [...new Set(data.bounties.map((bounty) => bounty.target_locale).filter((locale): locale is string => Boolean(locale)))].sort();
  const settled = data.bounties.filter((bounty) => bounty.status === 'Released');
  const paid = settled.reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n);
  // Category totals are computed from currently claimable work, never sample market data.
  const workTypes = [
    { type: 'Bug', label: 'Bug fixes', icon: Bug },
    { type: 'Feature', label: 'Features', icon: Blocks },
    { type: 'Audit', label: 'Security audits', icon: ShieldCheck },
    { type: 'Translation', label: 'Translations', icon: Languages },
  ];
  const localeNames: Record<string, string> = { es: 'Spanish', bn: 'Bengali', ja: 'Japanese', fr: 'French', de: 'German', pt: 'Portuguese', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', ar: 'Arabic' };
  return <>
    {heading}
    <section className="overview-strip" aria-label="Bounty queue overview">
      <div className="overview-primary"><div><span className="overview-label">{data.mode === 'demo' ? 'Example escrow balance' : 'Held in escrow'}</span><strong className="tabular-nums">{formatNear(held.toString())} <span>NEAR</span></strong><span className="overview-footnote"><LockKeyhole size={13} aria-hidden="true" />Reward held until merge</span></div></div>
      <dl className="overview-metrics"><div><dt>Open bounties</dt><dd className="tabular-nums">{open.length}<span>ready to claim</span></dd></div><div><dt>PRs in review</dt><dd className="tabular-nums">{inReview}<span>awaiting verification</span></dd></div><div><dt>{data.mode === 'demo' ? 'Example rewards paid' : 'Rewards paid'}</dt><dd className="tabular-nums">{formatNear(paid.toString())}<span>NEAR settled</span></dd></div></dl>
    </section>
    <div className="work-type-overview" role="group" aria-label="Open rewards by work type">{workTypes.map(({ type: kind, label, icon: Icon }) => {
      const available = open.filter((bounty) => bounty.bounty_type === kind);
      const reward = available.reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n);
      return <button className={`work-type-card work-type-${kind.toLowerCase()}`} key={kind} aria-pressed={type === kind && status === 'Open'} onClick={() => { setType(kind); setStatus('Open'); }}><span className="sr-only">Browse open </span><span className="work-type-heading"><span className="work-type-symbol"><Icon size={19} aria-hidden="true" /></span><strong>{label}</strong><ArrowUpRight size={17} aria-hidden="true" /></span><span className="work-type-bottom"><span className="work-type-amount tabular-nums">{formatNear(reward.toString())}<small>NEAR</small></span><span>{available.length} open</span></span></button>;
    })}</div>
    <WalletNotice />
    {error && <div className="notice notice-error" role="alert"><p>Could not refresh the queue. Showing the last loaded data. {error}</p><button className="text-button" onClick={retry}>Retry</button></div>}
    <div className="board-layout">
    <aside className="locale-panel" aria-label="Translation locale coverage">
      <div className="locale-panel-title"><h2>Translation desk</h2><Languages size={22} aria-hidden="true" /></div>
      <p>Open source speaks your language.</p>
      <div className="locale-list">{locales.length ? locales.map((locale) => {
        const count = data.bounties.filter((bounty) => bounty.target_locale === locale).length;
        return <div className="locale-entry" key={locale}><span className="locale-monogram">{locale}</span><div><strong>{localeNames[locale] || locale}</strong><span>{count} {count === 1 ? 'bounty' : 'bounties'}</span></div></div>;
      }) : <p>No translation bounties yet. Fund the first one.</p>}</div>
      <button className="locale-action" onClick={() => { setType('Translation'); setStatus('all'); setSearch(''); }}>Explore translations<ArrowUpRight size={17} aria-hidden="true" /></button>
      <div className="locale-settlement"><GitMerge size={22} aria-hidden="true" /><strong>Your contributor record</strong><p>Settled rewards add points to the NEAR account you contribute with.</p><Link href="/leaderboard">Meet the contributors<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
    </aside>
    <section className="work-panel" aria-label="Browse bounties"><div className="queue-viewbar"><div className="queue-views" role="group" aria-label="Quick bounty views"><button aria-pressed={type === 'all' && status === 'all'} onClick={() => { setType('all'); setStatus('all'); }}><LayoutList size={16} aria-hidden="true" />All work<span>{data.bounties.length}</span></button><button aria-pressed={type === 'all' && status === 'Open'} onClick={() => { setType('all'); setStatus('Open'); }}><CircleCheck size={16} aria-hidden="true" />Open to claim<span>{open.length}</span></button><button aria-pressed={type === 'Translation'} onClick={() => { setType('Translation'); setStatus('all'); }}><Languages size={16} aria-hidden="true" />Translations</button></div><span className="queue-view-note"><ShieldCheck size={14} aria-hidden="true" />Escrow-backed work</span></div>
    <div className="filter-bar" role="search" aria-label="Filter bounties">
      <div className="filter-field"><label htmlFor="queue-search">Find an issue</label><div className="search-wrap"><Search size={16} aria-hidden="true" /><input id="queue-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issues, repositories, or locales" type="search" /></div></div>
      <div className="filter-field"><label htmlFor="queue-type">Work type</label><select id="queue-type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{BOUNTY_TYPES.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="filter-field"><label htmlFor="queue-status">Status</label><select id="queue-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="Open">Open</option><option value="Claimed">In progress</option><option value="Submitted">In review</option><option value="Rejected">Needs changes</option><option value="Released">Settled</option><option value="Expired">Expired</option><option value="Refunded">Refunded</option><option value="Releasing">Paying reward</option><option value="Refunding">Refund pending</option></select></div>
      <div className="filter-field"><label htmlFor="queue-reward">Min. NEAR</label><input id="queue-reward" value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Minimum reward in NEAR" aria-invalid={rewardFilterError} aria-describedby={rewardFilterError ? 'reward-filter-error' : undefined} /></div>
    </div>
    {rewardFilterError && <p id="reward-filter-error" className="field-error" role="alert">Enter a decimal reward such as 2.50. The reward filter is not applied until the amount is valid.</p>}
    <div className="queue-summary"><span aria-live="polite">{filtered.length} {filtered.length === 1 ? 'bounty' : 'bounties'}{type !== 'all' ? ` in ${type.toLowerCase()}` : ' in the queue'}</span><div className="queue-sort"><ArrowDownUp size={13} aria-hidden="true" /><label className="sr-only" htmlFor="queue-sort">Sort bounties</label><select id="queue-sort" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="reward">Highest reward</option><option value="deadline">Nearest deadline</option></select></div></div>
    <BountyQueue bounties={filtered} emptyAction={<button className="button button-quiet" onClick={reset}><SlidersHorizontal size={16} aria-hidden="true" />Clear filters</button>} />
    </section>
    </div>
    <p className="queue-footnote"><ShieldCheck size={15} aria-hidden="true" />Escrow settles to the claimant after the verifier checks the merged pull request. Maintainers can also approve a submitted reward.</p>
  </>;
}
