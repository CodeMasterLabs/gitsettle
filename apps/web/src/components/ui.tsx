'use client';

import Link from 'next/link';
import { ArrowUpRight, Blocks, Bug, ChevronRight, CircleAlert, Clock3, FileText, Inbox, Languages, ShieldCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BountyView } from '@gitsettle/shared/types';
import { formatNear, isExpired } from '@gitsettle/shared/format';
import { dateLabel, issueNumber } from '@/lib/client';
import { useWallet } from './wallet-provider';

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function PageSkeleton({ rows = 5, hideHeading = false }: { rows?: number; hideHeading?: boolean }) {
  return <div className={`page-skeleton${hideHeading ? ' skeleton-under-heading' : ''}`} aria-busy="true" aria-label="Loading content"><span className="sr-only">Loading content…</span>{!hideHeading && <><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-subtitle" /></>}<div className="skeleton skeleton-toolbar" />{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-meta" /></div><div className="skeleton skeleton-value" /></div>)}</div>;
}

export function DataError({ error, retry }: { error: string; retry: () => void }) {
  return <div className="empty-state error-state" role="alert"><CircleAlert size={28} aria-hidden="true" /><h2>This view could not be loaded.</h2><p>{error}</p><button className="button button-primary" onClick={retry}>Try again</button></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox size={30} strokeWidth={1.5} aria-hidden="true" /><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function WalletNotice({ purpose = 'claim work or fund a bounty' }: { purpose?: string }) {
  const { accountId, connect, config, ready } = useWallet();
  if (accountId || config?.mode === 'demo') return null;
  return <div className="notice wallet-notice"><Wallet size={19} aria-hidden="true" /><p>Connect your NEAR wallet to {purpose}.</p><button className="text-button" disabled={!ready || !config?.contractId} onClick={connect}>Connect wallet</button></div>;
}

const statusNames: Record<string, string> = { Open: 'Open', Claimed: 'In progress', Submitted: 'In review', Rejected: 'Needs changes', Releasing: 'Paying reward', Released: 'Settled', Refunding: 'Refund pending', Refunded: 'Refunded' };
export function StatusBadge({ bounty }: { bounty: Pick<BountyView, 'status' | 'deadline'> }) {
  const expired = isExpired(bounty);
  return <span className={`status-badge status-${expired ? 'expired' : bounty.status.toLowerCase()}`}><span className="status-dot" />{expired ? 'Expired' : statusNames[bounty.status] || bounty.status}</span>;
}

export function TypeBadge({ type, locale }: { type: string; locale?: string | null }) {
  return <span className="type-group"><span className={`type-label type-${type.toLowerCase()}`}>{type}</span>{locale && <span className="locale-badge" title={`Target locale: ${locale}`}>{locale}</span>}</span>;
}

export function BountyQueue({ bounties, emptyAction }: { bounties: BountyView[]; emptyAction?: ReactNode }) {
  if (!bounties.length) return <EmptyState title="No bounties match these filters." description="Try another type or reward range, or bring a new issue to the queue." action={emptyAction} />;
  return <div className="queue-surface"><div className="queue-head" aria-hidden="true"><span>Issue & repository</span><span>Work type</span><span>Reward</span><span>Status</span></div><div role="list">
    {bounties.map((bounty) => {
      const Icon = { Bug, Feature: Blocks, Audit: ShieldCheck, Translation: Languages, Other: FileText }[bounty.bounty_type];
      return <div role="listitem" className="bounty-row" key={bounty.id}>
      <div className="queue-issue"><span className={`issue-icon issue-icon-${bounty.bounty_type.toLowerCase()}`}><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></span><div><Link className="bounty-title" href={`/bounties/${bounty.id}`}>{bounty.title}</Link><div className="issue-meta"><a href={bounty.issue_url} target="_blank" rel="noreferrer">{bounty.repo} <span>#{issueNumber(bounty.issue_url)}</span><ArrowUpRight size={12} aria-hidden="true" /></a></div></div></div>
      <div className="queue-type"><TypeBadge type={bounty.bounty_type} locale={bounty.target_locale} /></div>
      <div className="queue-reward tabular-nums"><strong>{formatNear(bounty.reward)}</strong><span>NEAR</span></div>
      <div className="queue-status"><StatusBadge bounty={bounty} /><span className="deadline"><Clock3 size={12} aria-hidden="true" />{dateLabel(bounty.deadline)}</span><ChevronRight className="queue-row-arrow" size={16} aria-hidden="true" /></div>
    </div>; })}
  </div></div>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="external-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}
