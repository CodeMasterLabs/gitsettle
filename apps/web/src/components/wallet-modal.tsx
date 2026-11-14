'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Copy, GitMerge, LoaderCircle, LogOut, ShieldCheck, Wallet, X } from 'lucide-react';
import { walletCatalog, walletDefinition, type WalletId } from '@/lib/wallet-catalog';
import './wallet-modal.css';

type Props = {
  open: boolean;
  view: 'providers' | 'account';
  accountId: string | null;
  accounts: string[];
  selectedWalletId: string | null;
  connectingId: WalletId | null;
  error: string | null;
  onClose(): void;
  onChoose(id: WalletId): void;
  onSwitch(): void;
  onDisconnect(): void;
  onAccount(accountId: string): void;
};

/** Native dialog supplies top-layer isolation and Escape semantics. An explicit
 * focus loop contains keyboard navigation and restores the opener on close. */
export function WalletModal(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const definition = walletDefinition(props.selectedWalletId);
  const connected = props.view === 'account' && props.accountId;
  const connecting = walletDefinition(props.connectingId);
  const [missingNightly, setMissingNightly] = useState(false);

  useEffect(() => {
    if (!props.open) { dialog.current?.close(); return; }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setCopied(false); setMissingNightly(false);
    dialog.current?.showModal();
    const keepFocusInDialog = (event: FocusEvent) => {
      const element = dialog.current;
      if (element?.open && !element.contains(event.target as Node)) element.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    };
    document.addEventListener('focusin', keepFocusInDialog);
    return () => {
      document.removeEventListener('focusin', keepFocusInDialog);
      document.body.style.overflow = previousOverflow;
      dialog.current?.close();
      // The connected header may replace the original Connect button. Do not
      // move focus to a detached node, or to another window's provider controls.
      if (opener.current?.isConnected) opener.current.focus();
      else document.querySelector<HTMLButtonElement>('[aria-label^="Manage wallet "]')?.focus();
    };
  }, [props.open]);

  function choose(id: WalletId) {
    if (id === 'nightly' && !(window as Window & { nightly?: { near?: unknown } }).nightly?.near) {
      setMissingNightly(true); return;
    }
    setMissingNightly(false); props.onChoose(id);
  }

  async function copyAccount() {
    try { await navigator.clipboard.writeText(props.accountId!); setCopied(true); }
    catch { setCopied(false); }
  }

  // A closed dialog has no provider image requests or hidden navigation links.
  if (!props.open) return null;

  return <dialog ref={dialog} className="wallet-dialog" aria-labelledby="wallet-dialog-title" aria-describedby="wallet-dialog-description" onCancel={event => { event.preventDefault(); props.onClose(); }} onClick={event => { if (event.target === event.currentTarget) props.onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="wallet-dialog-layout">
      <aside className="wallet-dialog-intro">
        <div className="wallet-modal-brand"><GitMerge size={22} aria-hidden="true" /><span>GitSettle</span></div>
        <div className="wallet-intro-copy"><span className="wallet-intro-symbol"><Wallet size={34} strokeWidth={1.4} aria-hidden="true" /></span><h2>Your work.<br />Your wallet.</h2><p>Fund an issue. Ship a contribution. Get paid when it merges.</p></div>
        <div className="wallet-intro-assurance"><ShieldCheck size={19} aria-hidden="true" /><span>You approve transactions in your wallet. GitSettle never asks for your recovery phrase.</span></div>
      </aside>
      <section className="wallet-dialog-content">
        <button className="wallet-dialog-close" aria-label="Close wallet dialog" onClick={props.onClose}><X size={20} aria-hidden="true" /></button>
        <span className="wallet-network-label"><span />NEAR Testnet</span>
        <h2 id="wallet-dialog-title">{connected ? 'Your wallet' : 'Connect a wallet'}</h2>
        <p id="wallet-dialog-description">{connected ? 'Manage your connection to GitSettle.' : 'Choose how you want to connect to GitSettle.'}</p>
        {props.error && <div className="wallet-dialog-error" role="alert">{props.error}</div>}
        {connected ? <>
          <div className="wallet-connected-provider">{definition && <img src={definition.icon} width={38} height={38} alt="" />}<div><strong>{definition?.name || 'NEAR wallet'}</strong><span>Connected on Testnet</span></div><Check size={18} aria-hidden="true" /></div>
          <div className="wallet-account-card"><span>Active account</span><strong>{props.accountId}</strong><button onClick={copyAccount} className="wallet-copy-button">{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Copied account' : 'Copy account'}</button></div>
          {props.accounts.length > 1 && <div className="wallet-account-select"><label htmlFor="wallet-active-account">Switch account</label><select id="wallet-active-account" value={props.accountId!} disabled={Boolean(props.connectingId)} onChange={event => props.onAccount(event.target.value)}>{props.accounts.map(account => <option key={account} value={account}>{account}</option>)}</select></div>}
          <div className="wallet-account-links"><Link href={`/contributors/${encodeURIComponent(props.accountId!)}`} onClick={props.onClose}>View contributor profile <ChevronRight size={17} aria-hidden="true" /></Link><a href={`https://testnet.nearblocks.io/address/${encodeURIComponent(props.accountId!)}`} target="_blank" rel="noreferrer">View on NEAR Explorer <ArrowUpRight size={16} aria-hidden="true" /></a></div>
          {definition && !definition.support && <p className="wallet-support-note">This adapter supports escrow transactions. For private support sign-in, choose MyNearWallet, Meteor Wallet, or Nightly.</p>}
          <div className="wallet-account-actions"><button className="wallet-switch-button" onClick={props.onSwitch}>Switch wallet</button><button className="wallet-disconnect-button" onClick={props.onDisconnect}><LogOut size={16} aria-hidden="true" />Disconnect</button></div>
        </> : missingNightly ? <div className="wallet-install-view"><img src="/wallets/nightly.svg" width={58} height={58} alt="" /><h3>Install Nightly to continue</h3><p>Nightly wasn’t detected in this browser. Install and unlock the extension, select NEAR Testnet, then return here.</p><a href="https://nightly.app/download" target="_blank" rel="noreferrer" className="wallet-install-link">Get Nightly <ArrowUpRight size={16} aria-hidden="true" /></a><button className="wallet-back-button" onClick={() => setMissingNightly(false)}><ArrowLeft size={16} aria-hidden="true" />Back to wallets</button></div> : <>
          <div className="wallet-provider-list" aria-label="Wallet providers">{walletCatalog.map(wallet => <button key={wallet.id} className="wallet-provider-option" onClick={() => choose(wallet.id)} disabled={Boolean(props.connectingId)}>
            <span className="sr-only">Connect with </span>
            <img src={wallet.icon} width={42} height={42} alt="" />
            <span className="wallet-provider-copy"><strong>{wallet.name}</strong><span>{wallet.kind}{!wallet.support && <span className="wallet-capability">Escrow only</span>}</span></span>
            {wallet.id === props.connectingId ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : <ChevronRight size={19} aria-hidden="true" />}
          </button>)}</div>
          {connecting ? <div className="wallet-connection-progress" role="status"><LoaderCircle className="spin" size={17} aria-hidden="true" /><span>Connecting to {connecting.name}. Finish the request in your wallet.</span></div> : <p className="wallet-connection-note">Use a Testnet account. Test NEAR has no monetary value.<br />New to NEAR? <a href="https://testnet.mynearwallet.com" target="_blank" rel="noreferrer">Create a test wallet <ArrowUpRight size={12} aria-hidden="true" /></a></p>}
          {connecting && <p className="wallet-connection-note">You can close this window to browse. Decline the request in your wallet to cancel the connection.</p>}
          <p className="wallet-support-note">Private support uses a separate signed message. Intear’s current adapter supports escrow transactions only.</p>
        </>}
      </section>
    </div>
  </dialog>;
}
