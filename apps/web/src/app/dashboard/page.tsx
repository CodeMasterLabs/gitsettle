'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import type { BoardData } from '@gitsettle/shared/types';
import { formatNear, isExpired } from '@gitsettle/shared/format';
import { useApi } from '@/lib/client';
import { BountyQueue, DataError, EmptyState, PageHeading, PageSkeleton } from '@/components/ui';
import { useWallet } from '@/components/wallet-provider';

export default function MaintainerDashboard() {
  const { data, error, loading, retry } = useApi<BoardData>('/api/bounties');
  const { accountId, config, connect, ready } = useWallet();
  const [tab, setTab] = useState('all');
  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  const displayAccount = accountId || (data.mode === 'demo' ? data.bounties[0]?.poster : null);
  if (!displayAccount) return <>
    <PageHeading title="Maintainer overview" description="Keep an eye on funded work, review submissions, and settle rewards." />
    <EmptyState title="Your funded work, in one place." description="Connect the NEAR account you use to post bounties. Only that account can approve rewards or request eligible refunds." action={<button className="button button-primary" onClick={connect} disabled={!ready || !config?.contractId}><Wallet size={17} aria-hidden="true" />Connect wallet</button>} />
  </>;
  const owned = data.bounties.filter((bounty) => bounty.poster === displayAccount);
  const held = owned.filter((bounty) => !['Released', 'Refunded'].includes(bounty.status)).reduce((sum, bounty) => sum + BigInt(bounty.reward), 0n);
  const review = owned.filter((bounty) => bounty.status === 'Submitted');
  const refundable = owned.filter((bounty) => isExpired(bounty));
  const filtered = owned.filter((bounty) => tab === 'all' || (tab === 'review' && bounty.status === 'Submitted') || (tab === 'expired' && isExpired(bounty)) || (tab === 'settled' && ['Released', 'Refunded'].includes(bounty.status)) || (tab === 'active' && !['Released', 'Refunded', 'Submitted'].includes(bounty.status) && !isExpired(bounty)));
  return <>
    <PageHeading title="Maintainer overview" description="A clear view of the work you’ve funded and what needs your attention." action={<Link className="button button-primary" href="/bounties/new"><Plus size={17} aria-hidden="true" />Post a bounty</Link>} />
    <p className="dashboard-account">{data.mode === 'demo' && !accountId ? 'Previewing an example maintainer: ' : 'Showing bounties posted by '}<strong>{displayAccount}</strong></p>
    <dl className="stat-line"><div><dt>{data.mode === 'demo' ? 'Example escrow' : 'Held in escrow'}</dt><dd>{formatNear(held.toString())} <span>NEAR</span></dd></div><div><dt>Ready for review</dt><dd>{review.length} <span>{review.length === 1 ? 'submission' : 'submissions'}</span></dd></div><div><dt>Past deadline</dt><dd>{refundable.length} <span>eligible for refund</span></dd></div></dl>
    <div className="section-heading"><h2>Your funded work</h2><p>{owned.length} {owned.length === 1 ? 'bounty' : 'bounties'} posted</p></div>
    <div className="dashboard-tabs" role="group" aria-label="Filter your bounties">{[{ id: 'all', label: 'All work' }, { id: 'active', label: 'In progress' }, { id: 'review', label: `Needs review (${review.length})` }, { id: 'expired', label: `Refund available (${refundable.length})` }, { id: 'settled', label: 'Settled' }].map((item) => <button className="tab-button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {owned.length ? <BountyQueue bounties={filtered} emptyAction={<button className="button button-quiet" onClick={() => setTab('all')}>Show all your bounties</button>} /> : <EmptyState title="You haven’t posted a bounty yet." description="Choose a scoped GitHub issue and fund a reward for the contributor who ships it." action={<Link className="button button-primary" href="/bounties/new">Post your first bounty</Link>} />}
    <p className="queue-footnote">Open a submitted bounty to review the PR and approve a payout. Expired work without a pending valid submission can be refunded. The storage reserve stays in the contract.</p>
  </>;
}
