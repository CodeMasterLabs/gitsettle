'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LockKeyhole, MessageSquare, Plus, Search, Send, ShieldCheck, Wallet } from 'lucide-react';
import type { Ticket, TicketDetail, TicketKind } from '@gitsettle/community/types';
import { communityRequest, useCommunity } from '@/components/community-provider';
import { useWallet } from '@/components/wallet-provider';
import { DataError, EmptyState, PageHeading } from '@/components/ui';
import { messageDate, usePrivateData } from '@/lib/community-client';
import { AiHelp } from '@/components/ai-help';

const ticketStatus = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const DRAFT_KEY = 'gitsettle.support-draft.v1';

function TicketState({ ticket }: { ticket: Ticket }) {
  return <span className={`status-badge ${ticket.status === 'resolved' ? 'status-released' : ticket.status === 'in_review' ? 'status-submitted' : ''}`}><span className="status-dot" />{ticketStatus[ticket.status]}</span>;
}

/** A private conversation is separate from contract state; every mutation is server authorized. */
export default function SupportDesk() {
  const { session, status, error: authError, authenticate, logout } = useCommunity();
  const { accountId, config, ready, connect } = useWallet();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<TicketKind>('support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bountyId, setBountyId] = useState('');
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState('all');
  const [ticketSearch, setTicketSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const draftIdentity = session?.accountId || accountId || 'unconnected';
  const [draftScope, setDraftScope] = useState('');
  const draftKey = `${DRAFT_KEY}:${draftIdentity}`;
  const tickets = usePrivateData<{ tickets: Ticket[] }>(session ? '/api/tickets' : null, session?.accountId || null);
  const thread = usePrivateData<TicketDetail>(session && selectedId && !creating ? `/api/tickets/${encodeURIComponent(selectedId)}` : null, session?.accountId || null);

  useEffect(() => {
    setKind('support'); setSubject(''); setBody(''); setBountyId(''); setCreating(false);
    try {
      sessionStorage.removeItem(DRAFT_KEY); // Discard the pre-release unscoped format.
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved) as Record<string, unknown>;
        if (draft.kind === 'appeal' || draft.kind === 'support') setKind(draft.kind);
        if (typeof draft.subject === 'string') setSubject(draft.subject);
        if (typeof draft.body === 'string') setBody(draft.body);
        if (typeof draft.bountyId === 'string') setBountyId(draft.bountyId);
        if (draft.creating === true) setCreating(true);
      }
      const params = new URL(window.location.href).searchParams;
      const appeal = params.get('appeal');
      if (appeal && /^\d+$/.test(appeal)) { setKind('appeal'); setBountyId(appeal); setSubject(`Appeal for bounty #${appeal}`); setCreating(true); }
      else if (params.get('ticket')) setSelectedId(params.get('ticket'));
    } catch { /* Invalid browser drafts do not affect server tickets. */ }
    setDraftScope(draftIdentity); setDraftReady(true);
  }, [draftIdentity, draftKey]);
  useEffect(() => {
    if (draftReady && draftScope === draftIdentity) sessionStorage.setItem(draftKey, JSON.stringify({ kind, subject, body, bountyId, creating }));
  }, [kind, subject, body, bountyId, creating, draftReady, draftScope, draftIdentity, draftKey]);
  useEffect(() => { setReply(''); setError(null); }, [selectedId, session?.accountId]);
  useEffect(() => {
    if (!selectedId && !creating && tickets.data?.tickets.length) setSelectedId(tickets.data.tickets[0].id);
  }, [tickets.data, selectedId, creating]);

  function selectTicket(id: string) {
    setSelectedId(id); setCreating(false); setError(null);
    const url = new URL(window.location.href); url.search = ''; url.searchParams.set('ticket', id); window.history.replaceState({}, '', url.toString());
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (kind === 'appeal' && (!/^\d+$/.test(bountyId) || !Number.isSafeInteger(Number(bountyId)))) { setError('Enter the bounty number you want to appeal.'); return; }
    if (subject.trim().length < 3 || body.trim().length < 5) { setError('Add a subject and a clear message so the maintainer can help.'); return; }
    setBusy(true);
    try {
      const result = await communityRequest<TicketDetail>('/api/tickets', { method: 'POST', body: JSON.stringify({ kind, subject: subject.trim(), body: body.trim(), ...(kind === 'appeal' ? { bountyId: Number(bountyId) } : {}) }) });
      setSubject(''); setBody(''); setBountyId(''); setKind('support'); selectTicket(result.ticket.id); tickets.refresh(); thread.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The ticket could not be created. Your message is preserved.'); }
    finally { setBusy(false); }
  }
  async function sendReply(event: React.FormEvent) {
    event.preventDefault(); if (!selectedId || !reply.trim()) return; setError(null); setBusy(true);
    try { await communityRequest(`/api/tickets/${encodeURIComponent(selectedId)}/messages`, { method: 'POST', body: JSON.stringify({ body: reply.trim() }) }); setReply(''); thread.refresh(); tickets.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The message could not be sent. Your text is preserved.'); }
    finally { setBusy(false); }
  }
  async function changeStatus(next: 'in_review' | 'resolved') {
    if (!selectedId) return; setBusy(true); setError(null);
    try { await communityRequest(`/api/tickets/${encodeURIComponent(selectedId)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); thread.refresh(); tickets.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The ticket could not be updated.'); }
    finally { setBusy(false); }
  }
  const allTickets = tickets.data?.tickets || [];
  const visibleTickets = allTickets.filter((ticket) => `${ticket.subject} ${ticket.bountyId ?? ''}`.toLowerCase().includes(ticketSearch.toLowerCase()) && (filter === 'all' || (filter === 'active' && ticket.status !== 'resolved') || (filter === 'resolved' && ticket.status === 'resolved')));
  return <>
    <PageHeading title="Support & appeals" description="Private conversations, clear context, and a direct path to the next step." action={session ? <button className="button button-primary" onClick={() => { setCreating(true); setError(null); }}><Plus size={17} aria-hidden="true" />Open a ticket</button> : undefined} />
    <div className="notice support-policy"><ShieldCheck size={18} aria-hidden="true" /><p><strong>Appeals are off-chain requests.</strong> They do not pause deadlines or refunds, and do not automatically change a verifier decision or reverse a payment.</p></div>
    {authError && <div className="notice notice-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><p>{authError}</p>{authError.startsWith('Server sign-out failed') && <button className="text-button" onClick={() => void logout()}>Retry sign-out</button>}</div>}
    {!session ? <div className="support-intro-grid"><section className="content-panel support-signin"><LockKeyhole size={27} color="var(--forest)" aria-hidden="true" /><h2 className="spaced-top">Keep the conversation private.</h2><p className="body-copy">Sign a message with your NEAR wallet to view your tickets. Message signing does not spend tokens or call the escrow contract.</p><div className="spaced-top">{status === 'loading' ? <p role="status">Checking your support session…</p> : status === 'signing' ? <p role="status">Review the sign-in message in your wallet. Your draft will be here when you return.</p> : accountId ? <button className="button button-primary" onClick={() => void authenticate()}><ShieldCheck size={17} aria-hidden="true" />Sign in to support</button> : <button className="button button-primary" disabled={!ready || config?.mode === 'demo' || !config?.contractId} onClick={connect}><Wallet size={17} aria-hidden="true" />Connect wallet</button>}</div>{config?.mode === 'demo' ? <p className="small-note spaced-top">Private support is available after this instance is connected to a testnet contract. Demo mode does not create accounts or tickets.</p> : <p className="small-note spaced-top">Only the ticket creator, its bounty poster, and authorized support maintainers can read a ticket.</p>}</section><AiHelp /></div> : <>
      <div className="support-session"><span><LockKeyhole size={14} aria-hidden="true" />Signed in as <strong>{session.accountId}</strong>{session.isAdmin && <span className="locale-badge">Support maintainer</span>}</span><button className="text-button" onClick={() => void logout()}>Sign out of support</button></div>
      <div className="support-layout"><aside className="ticket-sidebar" aria-label="Your private tickets"><div className="ticket-sidebar-heading"><h2>Your conversations</h2><span className="small-note tabular-nums">{allTickets.length}</span></div><div className="ticket-search"><label className="sr-only" htmlFor="ticket-search">Find a conversation</label><Search size={14} aria-hidden="true" /><input id="ticket-search" type="search" value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} placeholder="Search conversations" /></div><label htmlFor="ticket-filter" className="sr-only">Filter conversations</label><select id="ticket-filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All conversations</option><option value="active">Open & in review</option><option value="resolved">Resolved</option></select>{tickets.loading && !tickets.data ? <div className="ticket-loading" role="status"><div className="skeleton" /><div className="skeleton" /><span className="sr-only">Loading private tickets…</span></div> : tickets.error && !tickets.data ? <div className="notice notice-error" role="alert"><p>{tickets.error}</p><button className="text-button" onClick={tickets.refresh}>Retry</button></div> : visibleTickets.length ? <div className="ticket-list">{visibleTickets.map((ticket) => <button className={`ticket-list-item${selectedId === ticket.id && !creating ? ' selected' : ''}`} key={ticket.id} onClick={() => selectTicket(ticket.id)} aria-current={selectedId === ticket.id && !creating ? 'true' : undefined}><span className="ticket-list-meta"><span>{ticket.kind === 'appeal' ? 'Appeal' : 'Support'}{ticket.bountyId !== null ? ` #${ticket.bountyId}` : ''}</span><TicketState ticket={ticket} /></span><strong>{ticket.subject}</strong><span className="ticket-list-bottom"><span>{messageDate(ticket.updatedAt)}</span><span><MessageSquare size={12} aria-hidden="true" />{ticket.messageCount}</span></span></button>)}</div> : <p className="small-note ticket-list-empty">No conversations in this view. Open a ticket when you need a hand.</p>}</aside>
      <div className="ticket-main">{error && <div className="notice notice-error" role="alert"><p>{error}</p></div>}
        {draftScope !== draftIdentity ? <section className="content-panel" role="status">Loading your private draft…</section> : creating ? <section className="content-panel"><h2>Open a private ticket</h2><p className="form-intro">Describe what happened and what would help. Share public issue or transaction links; never share a private key.</p><form onSubmit={create}><div className="form-row"><div className="form-field"><label htmlFor="ticket-kind">Conversation type</label><select id="ticket-kind" value={kind} onChange={(event) => { const next = event.target.value as TicketKind; setKind(next); if (next === 'support') setBountyId(''); }}><option value="support">Support question</option><option value="appeal">Verification appeal</option></select></div>{kind === 'appeal' && <div className="form-field"><label htmlFor="ticket-bounty">Bounty number</label><input id="ticket-bounty" value={bountyId} onChange={(event) => setBountyId(event.target.value)} inputMode="numeric" pattern="[0-9]*" required placeholder="For example, 7" /></div>}</div>{kind === 'appeal' && <p className="small-note spaced-bottom">Appeals are available to the claimant while a bounty is submitted or rejected. Opening one does not pause expiry or reserve funds.</p>}<div className="form-field"><label htmlFor="ticket-subject">Subject</label><input id="ticket-subject" maxLength={120} minLength={3} required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What would you like help with?" /></div><div className="form-field"><label htmlFor="ticket-body">Your message</label><textarea id="ticket-body" minLength={5} maxLength={4000} required rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Include the relevant issue, pull request, or transaction, and explain your question." /><span className="field-help tabular-nums">{body.length.toLocaleString('en-US')} / 4,000 characters</span></div><div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setCreating(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}><Send size={16} aria-hidden="true" />{busy ? 'Opening ticket…' : 'Open ticket'}</button></div></form></section> : thread.loading && !thread.data && selectedId ? <section className="content-panel" aria-busy="true"><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-toolbar" /><div className="skeleton skeleton-subtitle" /><span className="sr-only">Loading conversation…</span></section> : thread.error && !thread.data ? <DataError error={thread.error} retry={thread.refresh} /> : thread.data ? <section className="ticket-conversation"><header className="ticket-conversation-heading"><div><div className="ticket-heading-meta"><span>{thread.data.ticket.kind === 'appeal' ? 'Verification appeal' : 'Support ticket'}</span><TicketState ticket={thread.data.ticket} /></div><h2>{thread.data.ticket.subject}</h2>{thread.data.ticket.bountyId !== null && <Link className="external-link spaced-top" href={`/bounties/${thread.data.ticket.bountyId}`}>View bounty #{thread.data.ticket.bountyId}</Link>}</div><div className="ticket-actions">{thread.data.ticket.permissions.canReview && thread.data.ticket.status === 'open' && <button className="button button-quiet compact" disabled={busy} onClick={() => void changeStatus('in_review')}>Mark in review</button>}{thread.data.ticket.permissions.canResolve && thread.data.ticket.status !== 'resolved' && <button className="button button-quiet compact" disabled={busy} onClick={() => void changeStatus('resolved')}><CheckCircle2 size={15} aria-hidden="true" />Resolve ticket</button>}</div></header>{thread.error && <div className="notice notice-error" role="alert"><p>Could not refresh this conversation. {thread.error}</p><button className="text-button" onClick={thread.refresh}>Retry</button></div>}<ol className="ticket-messages" aria-label="Conversation messages">{thread.data.messages.map((message) => <li key={message.id} className={`ticket-message${message.authorAccount === session.accountId ? ' own-message' : ''}`}><div className="message-meta"><strong>{message.authorAccount === session.accountId ? 'You' : message.authorAccount}</strong><time dateTime={message.createdAt}>{messageDate(message.createdAt)}</time></div><p>{message.body}</p></li>)}</ol>{thread.data.ticket.permissions.canReply ? <form className="ticket-reply" onSubmit={sendReply}><label htmlFor="ticket-reply">Reply to this conversation</label><textarea id="ticket-reply" required maxLength={4000} rows={4} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add context or ask a follow-up question." /><div className="ticket-reply-actions"><span className="small-note">Replies refresh every 15 seconds.</span><button className="button button-primary" disabled={busy || !reply.trim()} type="submit"><Send size={15} aria-hidden="true" />{busy ? 'Sending…' : 'Send reply'}</button></div></form> : <div className="ticket-resolved"><CheckCircle2 size={18} aria-hidden="true" /><p>This ticket is resolved. The conversation remains available for reference.</p></div>}</section> : <EmptyState title="A conversation starts with a question." description="Open a support ticket or an appeal. Your conversation is visible only to its participants and authorized maintainers." action={<button className="button button-primary" onClick={() => setCreating(true)}>Open a ticket</button>} />}
      </div></div><AiHelp />
    </>}
  </>;
}
