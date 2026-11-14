'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
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
  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  const open = data.bounties.filter((bounty) => bounty.status === 'Open' && !isExpired(bounty));
  const held = data.bounties.filter((bounty) => !['Released', 'Refunded'].includes(bounty.status)).reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n);
  return <>
    <PageHeading title="The work queue" description="Fix a bug. Ship a feature. Bring a project to a new language." action={<Link className="button button-primary" href="/bounties/new"><Plus size={17} aria-hidden="true" />Post a bounty</Link>} />
    <div className="board-caption"><span><strong className="tabular-nums">{open.length}</strong> bounties open for contribution <span aria-hidden="true">/</span> <strong className="tabular-nums">{formatNear(held.toString())} NEAR</strong> {data.mode === 'demo' ? 'in example rewards' : 'held in escrow'}</span><span className="escrow-explainer"><ShieldCheck size={16} aria-hidden="true" />Reward held until merge</span></div>
    <WalletNotice />
    {error && <div className="notice notice-error" role="alert"><p>Could not refresh the queue. Showing the last loaded data. {error}</p><button className="text-button" onClick={retry}>Retry</button></div>}
    <div className="filter-bar" role="search" aria-label="Filter bounties">
      <div className="filter-field"><label htmlFor="queue-search">Find an issue</label><div className="search-wrap"><Search size={16} aria-hidden="true" /><input id="queue-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issues, repositories, or locales" type="search" /></div></div>
      <div className="filter-field"><label htmlFor="queue-type">Work type</label><select id="queue-type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">All types</option>{BOUNTY_TYPES.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="filter-field"><label htmlFor="queue-status">Status</label><select id="queue-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="Open">Open</option><option value="Claimed">In progress</option><option value="Submitted">In review</option><option value="Rejected">Needs changes</option><option value="Released">Settled</option><option value="Expired">Expired</option><option value="Refunded">Refunded</option><option value="Releasing">Paying reward</option><option value="Refunding">Refund pending</option></select></div>
      <div className="filter-field"><label htmlFor="queue-reward">Min. NEAR</label><input id="queue-reward" value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Minimum reward in NEAR" aria-invalid={rewardFilterError} aria-describedby={rewardFilterError ? 'reward-filter-error' : undefined} /></div>
    </div>
    {rewardFilterError && <p id="reward-filter-error" className="field-error" role="alert">Enter a decimal reward such as 2.50. The reward filter is not applied until the amount is valid.</p>}
    <div className="queue-summary"><span aria-live="polite">{filtered.length} {filtered.length === 1 ? 'bounty' : 'bounties'}{type !== 'all' ? ` in ${type.toLowerCase()}` : ' in the queue'}</span><div><label className="sr-only" htmlFor="queue-sort">Sort bounties</label><select id="queue-sort" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="reward">Highest reward</option><option value="deadline">Nearest deadline</option></select></div></div>
    <BountyQueue bounties={filtered} emptyAction={<button className="button button-quiet" onClick={reset}><SlidersHorizontal size={16} aria-hidden="true" />Clear filters</button>} />
    <p className="queue-footnote"><ShieldCheck size={15} aria-hidden="true" />Escrow settles to the claimant after the verifier checks the merged pull request. Maintainers can also approve a submitted reward.</p>
  </>;
}
