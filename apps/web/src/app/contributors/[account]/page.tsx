'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Wallet } from 'lucide-react';
import type { BountyView, Contributor, PublicConfig } from '@gitsettle/shared/types';
import { formatNear } from '@gitsettle/shared/format';
import { useApi } from '@/lib/client';
import { BountyQueue, DataError, EmptyState, ExternalLink, PageSkeleton } from '@/components/ui';
import { useWallet } from '@/components/wallet-provider';

type ProfileData = PublicConfig & { profile: Contributor; bounties: BountyView[] };

export default function ContributorProfile() {
  const { account } = useParams<{ account: string }>();
  const { accountId, config, ready, connect } = useWallet();
  const effectiveAccount = account === 'me' ? accountId : account;
  const { data, error, loading, retry } = useApi<ProfileData>(effectiveAccount ? `/api/contributors/${encodeURIComponent(effectiveAccount)}` : null);
  if (account === 'me' && !effectiveAccount) return <>
    <div className="page-heading"><div><h1>My contributions</h1><p>Your work, rewards, and reputation live with your NEAR account.</p></div></div>
    <EmptyState title="Connect to see your contributions." description="Use the wallet you claimed bounties with. Your profile updates when rewards settle." action={<>{config?.mode === 'demo' ? <Link className="button button-primary" href="/contributors/maya.demo.testnet">View example contributor</Link> : <button className="button button-primary" onClick={connect} disabled={!ready || !config?.contractId}><Wallet size={17} aria-hidden="true" />Connect wallet</button>}</>} />
  </>;
  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <DataError error={error} retry={retry} />;
  if (!data) return null;
  const profile = data.profile;
  return <>
    <Link href="/leaderboard" className="back-link"><ArrowLeft size={16} aria-hidden="true" />Contributor leaderboard</Link>
    <div className="page-heading profile-heading"><div className="profile-identity"><span className="contributor-avatar" aria-hidden="true">{profile.account_id[0]?.toUpperCase()}</span><div><h1 className="profile-title">{profile.account_id}</h1><p>Contributor profile <span aria-hidden="true">/</span> NEAR Testnet</p></div></div></div>
    <ExternalLink href={`https://testnet.nearblocks.io/address/${encodeURIComponent(profile.account_id)}`}>View account on NEAR</ExternalLink>
    <dl className="stat-line"><div><dt>Contribution points</dt><dd>{profile.points.toLocaleString('en-US')}</dd></div><div><dt>Merged contributions</dt><dd>{profile.merged_count}</dd></div><div><dt>Total earned</dt><dd>{formatNear(profile.total_earned)} <span>NEAR</span></dd></div></dl>
    <div className="section-heading"><h2>Contribution history</h2><p>{data.bounties.length} {data.bounties.length === 1 ? 'bounty' : 'bounties'}</p></div>
    {data.bounties.length ? <BountyQueue bounties={data.bounties} /> : <EmptyState title="No contributions yet." description="Claim an open bounty, submit the work, and earn reputation when the reward settles." action={<Link className="button button-primary" href="/">Explore open work</Link>} />}
    <p className="queue-footnote">Points are credited only after a successful reward transfer. Claims and unmerged submissions do not add points.</p>
  </>;
}
