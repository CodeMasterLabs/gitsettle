'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, Code2, GitMerge, LayoutGrid, LayoutList, LoaderCircle, MessageSquare, Moon, Settings2, ShieldCheck, Sun, Terminal, Trophy, UserRound, Wallet, X } from 'lucide-react';
import { shortAccount } from '@/lib/client';
import { useWallet } from './wallet-provider';

const navigation = [
  { href: '/', label: 'Work queue', icon: LayoutList },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/contributors/me', label: 'My contributions', icon: UserRound },
  { href: '/dashboard', label: 'Maintainer desk', icon: Settings2 },
  { href: '/support', label: 'Support & appeals', icon: MessageSquare },
];

function TransactionNotice() {
  const { transaction, clearTransaction, retryConfirmation, recoverTransaction, dismissUnsent, accountId } = useWallet();
  const [recoveryHash, setRecoveryHash] = useState('');
  const [checkedWallet, setCheckedWallet] = useState(false);
  if (!transaction) return null;
  const Icon = transaction.status === 'pending' ? LoaderCircle : transaction.status === 'confirmed' ? CheckCircle2 : CircleAlert;
  return <div className={`transaction-notice transaction-${transaction.status}`} role={transaction.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
    <Icon className={transaction.status === 'pending' ? 'spin' : ''} size={20} aria-hidden="true" />
    <div><strong>{transaction.status === 'pending' ? 'Transaction pending' : transaction.status === 'confirmed' ? 'Transaction confirmed' : 'Transaction not completed'}</strong>
      <p>{transaction.message}</p>
      <div className="inline-links">
        {transaction.hash && <a href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transaction.hash)}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={13} aria-hidden="true" /></a>}
        {transaction.status === 'pending' && transaction.hash && <button className="text-button" onClick={retryConfirmation}>Check again</button>}
        {transaction.status === 'confirmed' && transaction.bountyId !== undefined && <Link href={`/bounties/${transaction.bountyId}`}>View bounty</Link>}
      </div>
      {transaction.status === 'pending' && !transaction.hash && <details className="transaction-recovery"><summary>Recover a missing wallet result</summary><p>Check your wallet activity. If the transaction was sent, paste its hash to verify the original action.</p>{accountId && <a className="external-link" href={`https://testnet.nearblocks.io/address/${encodeURIComponent(accountId)}`} target="_blank" rel="noreferrer">Open account activity <ArrowUpRight size={13} aria-hidden="true" /></a>}<form onSubmit={(event) => { event.preventDefault(); recoverTransaction(recoveryHash); }}><label htmlFor="recovery-hash">Transaction hash</label><div className="recovery-input"><input id="recovery-hash" value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} pattern="[1-9A-HJ-NP-Za-km-z]{32,64}" required /><button className="button button-quiet" type="submit">Check result</button></div></form><div className="check-row"><input type="checkbox" id="checked-wallet" checked={checkedWallet} onChange={(event) => setCheckedWallet(event.target.checked)} /><label htmlFor="checked-wallet">I checked my wallet and confirmed that no transaction was sent.</label></div><button className="text-button" disabled={!checkedWallet} onClick={dismissUnsent}>Clear unsent request</button></details>}
    </div>
    {transaction.status !== 'pending' && <button className="icon-button dismiss-button" aria-label="Dismiss transaction message" onClick={clearTransaction}><X size={18} /></button>}
  </div>;
}

/** Persistent navigation makes account and network identity visible on every workflow. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { config, accountId, connect, disconnect, ready, error } = useWallet();
  const [theme, setTheme] = useState('light');
  useEffect(() => { setTheme(document.documentElement.dataset.theme || 'light'); }, []);
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem('gitsettle.theme', next);
  }
  const location = path === '/' ? 'Work queue' : path === '/bounties/new' ? 'Create a bounty' : path.startsWith('/bounties/') ? 'Bounty details' : path.startsWith('/contributors') ? 'Contributor profile' : path === '/leaderboard' ? 'Leaderboard' : path === '/dashboard' ? 'Maintainer overview' : path === '/support' ? 'Support & appeals' : 'Workspace';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <Link href="/" className="wordmark" aria-label="GitSettle home"><span className="brand-symbol"><GitMerge size={22} aria-hidden="true" /></span>GitSettle</Link>
      <span className="sidebar-network"><span className="network-dot" />NEAR Testnet</span>
      <div className="workspace-identity"><span className="workspace-avatar"><Code2 size={18} aria-hidden="true" /></span><div><strong>Community workspace</strong><span>Contribution escrow</span></div></div>
      <nav aria-label="Main navigation">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' || path.startsWith('/bounties') : path.startsWith(href === '/contributors/me' ? '/contributors' : href);
          return <Link key={href} href={href} className={`nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span>{active && <span className="nav-active-dot" aria-hidden="true" />}</Link>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-assurance"><ShieldCheck size={20} aria-hidden="true" /><strong>Built on clear commitments.</strong><p>Fund the work. Verify the merge. Settle the reward.</p><a href="https://github.com/CodeMasterLabs/gitsettle#trust-model-and-limitations" target="_blank" rel="noreferrer">How escrow works <ArrowUpRight size={13} aria-hidden="true" /></a></div>
        <a className="source-link" href="https://github.com/CodeMasterLabs/gitsettle" target="_blank" rel="noreferrer"><Code2 size={16} aria-hidden="true" />View source <ArrowUpRight size={13} aria-hidden="true" /></a>
        <a className="source-link" href="https://github.com/CodeMasterLabs/gitsettle/blob/main/docs/CLI.md" target="_blank" rel="noreferrer"><Terminal size={16} aria-hidden="true" />Command line <ArrowUpRight size={13} aria-hidden="true" /></a>
        <div className="sidebar-version"><span className="network-dot" />Self-hosted workspace</div>
      </div>
    </aside>
    <div className="workspace">
      <header className={`topbar${accountId ? ' has-account' : ''}`}><nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/" aria-label="Workspace home"><LayoutGrid size={17} aria-hidden="true" /><span>Workspace</span></Link><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{location}</span></nav>
        <div className="topbar-actions"><span className="network-pill"><span className="network-dot" />NEAR Testnet</span><button className="theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? 'Dark appearance' : 'Light appearance'} title={theme === 'light' ? 'Dark appearance' : 'Light appearance'}>{theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button><div className="wallet-controls">{accountId ? <>
          <Link className="account-link" href={`/contributors/${encodeURIComponent(accountId)}`} title={accountId}><span className="account-dot" />{shortAccount(accountId)}</Link>
          <button className="button button-quiet compact" onClick={() => void disconnect()}>Disconnect</button>
        </> : <button className="button button-quiet wallet-button" onClick={connect} disabled={!ready || !config?.contractId || config.mode === 'demo'}><Wallet size={16} aria-hidden="true" />{ready ? 'Connect wallet' : 'Loading wallet…'}</button>}</div></div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {error && <div className="notice notice-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><p>{error}</p></div>}
        {config?.mode === 'demo' && <div className="notice notice-demo"><CircleAlert size={18} aria-hidden="true" /><p><strong>Demo data.</strong> These rewards are examples, not funded escrows. Wallet transactions are disabled. <a href="https://github.com/CodeMasterLabs/gitsettle#self-hosting" target="_blank" rel="noreferrer">Configure testnet</a></p></div>}
        <TransactionNotice />
        {children}
      </main>
      <footer className="footer"><span>GitSettle <span className="footer-divider" />Contribution infrastructure for open source.</span><nav className="footer-links" aria-label="Resources"><a href="https://github.com/CodeMasterLabs/gitsettle/blob/main/docs/CLI.md" target="_blank" rel="noreferrer"><Terminal size={14} aria-hidden="true" />Command line <ArrowUpRight size={13} aria-hidden="true" /></a><a href="https://github.com/CodeMasterLabs/gitsettle#trust-model-and-limitations" target="_blank" rel="noreferrer">Settlement rules <ArrowUpRight size={13} aria-hidden="true" /></a></nav></footer>
    </div>
  </div>;
}
