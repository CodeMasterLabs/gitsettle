'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { communityRequest, useCommunity } from './community-provider';
import { useWallet } from './wallet-provider';

type AiMessage = { role: 'user' | 'assistant'; content: string };

/** AI conversations are advisory; private ticket threads are never sent automatically. */
export function AiHelp() {
  const { session, authenticate, status } = useCommunity();
  const { accountId, connect, ready, config: walletConfig } = useWallet();
  const [config, setConfig] = useState<{ configured: boolean; model?: string } | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [messageScope, setMessageScope] = useState(session?.accountId);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const activeAccount = useRef(session?.accountId);
  activeAccount.current = session?.accountId;
  useEffect(() => {
    const controller = new AbortController();
    void communityRequest<{ configured: boolean; model?: string }>('/api/ai/chat', { signal: controller.signal }).then((value) => { setConfig(value); setError(null); }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'AI availability could not be checked.'); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => { setMessages([]); setQuestion(''); setMessageScope(session?.accountId); }, [session?.accountId]);
  const visibleMessages = messageScope === session?.accountId ? messages : [];
  const visibleQuestion = messageScope === session?.accountId ? question : '';
  async function ask(event: React.FormEvent) {
    event.preventDefault(); if (!visibleQuestion.trim() || !session || loading || messageScope !== session.accountId) return;
    const next: AiMessage[] = [...messages.slice(-8), { role: 'user', content: question.trim() }];
    const requestedAccount = session.accountId;
    setLoading(true); setError(null);
    try {
      const result = await communityRequest<{ configured: boolean; reply: string; model?: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: question.trim(), history: messages.slice(-8) }) });
      if (activeAccount.current === requestedAccount) { setMessages([...next, { role: 'assistant', content: result.reply }]); setQuestion(''); }
    } catch (reason) { if (activeAccount.current === requestedAccount) setError(reason instanceof Error ? reason.message : 'AI help is unavailable right now. Your question is preserved.'); }
    finally { setLoading(false); }
  }
  return <section className="content-panel ai-help" aria-labelledby="ai-help-title"><div className="ai-help-heading"><MessageCircle size={21} aria-hidden="true" /><h2 id="ai-help-title">Ask the AI helper</h2></div>
    {!config && !error ? <p className="small-note" role="status">Checking whether AI help is available…</p> : !config && error ? <><p className="small-note">{error}</p><button className="text-button" onClick={() => setRevision((value) => value + 1)}>Check again</button></> : !config?.configured ? <><p className="body-copy">AI help is not enabled on this instance. You can still open a private support ticket for a maintainer.</p><p className="small-note spaced-top">When enabled by the host, AI can explain verification rules and help you prepare a clearer appeal. It cannot authorize a payout.</p></> : <>
      <p className="body-copy">Get help understanding a verification rule or preparing your next step. AI advice does not change a bounty, move funds, or decide an appeal.</p>
      {visibleMessages.length > 0 && <ol className="ai-thread" aria-label="AI conversation">{visibleMessages.map((message, index) => <li className={`ai-message ai-message-${message.role}`} key={index}><strong>{message.role === 'user' ? 'You' : 'AI helper'}</strong><p>{message.content}</p></li>)}</ol>}
      {error && <div className="notice notice-error spaced-top" role="alert"><p>{error}</p></div>}
      {session ? <form className="spaced-top" onSubmit={ask}><label htmlFor="ai-question">Your question</label><textarea id="ai-question" maxLength={2000} required rows={3} value={visibleQuestion} onChange={(event) => setQuestion(event.target.value)} placeholder="For example, why does my translation PR need a locale path?" /><p className="small-note spaced-top">Only messages you send here go to the host’s configured AI provider. Ticket conversations are not included automatically. Do not share private keys or sensitive personal information.</p><button type="submit" className="button button-quiet" disabled={loading || !visibleQuestion.trim()}><Send size={15} aria-hidden="true" />{loading ? 'Waiting for AI reply…' : 'Ask AI helper'}</button>{loading && <span className="sr-only" role="status">The AI helper is preparing a reply.</span>}</form> : <div className="spaced-top"><p className="small-note">A signed wallet session is required to use this optional service.</p>{accountId ? <button className="button button-quiet spaced-top" onClick={() => void authenticate()} disabled={status === 'signing'}><ShieldCheck size={16} aria-hidden="true" />{status === 'signing' ? 'Waiting for wallet…' : 'Sign in for AI help'}</button> : <button className="button button-quiet spaced-top" onClick={connect} disabled={!ready || walletConfig?.mode === 'demo' || !walletConfig?.contractId}>Connect wallet</button>}</div>}
    </>}
  </section>;
}
