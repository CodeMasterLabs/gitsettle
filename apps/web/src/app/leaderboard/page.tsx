'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, Minus, ShieldCheck } from 'lucide-react';
import type { PublicConfig, RankedContributor } from '@gitsettle/shared/types';
import { formatNear } from '@gitsettle/shared/format';
import { dateLabel, useApi } from '@/lib/client';
import { DataError, EmptyState, PageHeading, PageSkeleton } from '@/components/ui';

type LeaderboardData = PublicConfig & { entries: RankedContributor[]; snapshotAt: number | null };

export default function Leaderboard() {
  const { data, error, loading, retry } = useApi<LeaderboardData>('/api/leaderboard');
  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  const total = data.entries.reduce((sum, entry) => sum + BigInt(entry.total_earned), 0n);
  return <>
    <PageHeading title="The contributor ledger" description="A record of useful work. Reputation grows with every settled contribution." action={<Link className="button button-primary" href="/">Find your next bounty</Link>} />
    <div className="board-caption"><span><strong className="tabular-nums">{data.entries.length}</strong> contributors ranked <span aria-hidden="true">/</span> <strong className="tabular-nums">{formatNear(total.toString())} NEAR</strong> {data.mode === 'demo' ? 'example earnings' : 'earned'}</span><span className="escrow-explainer"><ShieldCheck size={16} aria-hidden="true" />100 points per settled merge</span></div>
    {error && <div className="notice notice-error" role="alert"><p>Could not refresh rankings. Showing the last loaded results.</p><button className="text-button" onClick={retry}>Retry</button></div>}
    {data.entries.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Contributor leaderboard, scroll horizontally on small screens"><table className="leaderboard"><caption className="sr-only">Contributors ranked by points, with merged contributions, NEAR earned, and rank movement</caption><thead><tr><th scope="col">Rank</th><th scope="col">Contributor</th><th scope="col">Points</th><th scope="col">Merged</th><th scope="col">Earned (NEAR)</th><th scope="col">Change</th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.account_id}><td><span className={`rank-number${entry.rank === 1 ? ' rank-first' : ''}`}>{String(entry.rank).padStart(2, '0')}</span></td><th scope="row" style={{ background: 'transparent', color: 'var(--ink)', textAlign: 'left', borderTop: '1px solid var(--faint-line)', fontSize: 15 }}><Link className="contributor-link" href={`/contributors/${encodeURIComponent(entry.account_id)}`}><span className="contributor-avatar" aria-hidden="true">{entry.account_id[0].toUpperCase()}</span>{entry.account_id}</Link></th><td><strong>{entry.points.toLocaleString('en-US')}</strong></td><td>{entry.merged_count}</td><td>{formatNear(entry.total_earned)}</td><td>{entry.movement === null ? <span className="rank-movement" aria-label="No previous snapshot">—</span> : entry.movement === 0 ? <span className="rank-movement" aria-label="Rank unchanged"><Minus size={14} aria-hidden="true" /></span> : <span className={`rank-movement rank-${entry.movement > 0 ? 'up' : 'down'}`} aria-label={`${entry.movement > 0 ? 'Up' : 'Down'} ${Math.abs(entry.movement)} ranks`}>{entry.movement > 0 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}{Math.abs(entry.movement)}</span>}</td></tr>)}</tbody></table></div> : <EmptyState title="The first contribution starts here." description="The leaderboard updates after a bounty reward is successfully paid. Claim an open issue to begin." action={<Link className="button button-primary" href="/">Open work queue</Link>} />}
    <p className="queue-footnote">Rank movement compares the current result with {data.snapshotAt ? `the saved snapshot from ${dateLabel(data.snapshotAt, true)}` : 'a previous saved snapshot, once one is available'}. Ties are ordered by account ID. The contract lists the top 100 contributors.</p>
  </>;
}
