'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { InjectedWallet, SignMessageParams, SignedMessage, WalletSelector } from '@near-wallet-selector/core';
import { walletDefinition, type WalletId } from '@/lib/wallet-catalog';
import { WalletModal } from './wallet-modal';
import type { PublicConfig } from '@gitsettle/shared/types';

type Method = 'create_bounty' | 'claim_bounty' | 'submit_pr' | 'release' | 'refund';
type Transaction = {
  status: 'pending' | 'confirmed' | 'failed';
  message: string;
  hash?: string;
  bountyId?: number;
  method?: Method;
};
type PendingAction = { method: Method; accountId: string; bountyId?: number; expectedArgs: Record<string, unknown>; createdAt: number; txHash?: string };
type WalletContextValue = {
  config: PublicConfig | null; accountId: string | null; ready: boolean; error: string | null;
  transaction: Transaction | null; connect: () => void; manageWallet: () => void; disconnect: () => Promise<void>;
  walletName: string | null; connectionPending: boolean;
  transact: (method: Method, args: Record<string, unknown>, deposit?: string) => Promise<void>;
  clearTransaction: () => void; retryConfirmation: () => void;
  recoverTransaction: (hash: string) => void; dismissUnsent: () => void;
  signAuthMessage: (params: SignMessageParams) => Promise<SignedMessage | void>;
};
const WalletContext = createContext<WalletContextValue | null>(null);
const PENDING_KEY = 'gitsettle.pending.v1';

/** New connections delegate NEAR transaction signing to the wallet provider.
 * This component persists only unsigned action metadata across redirects. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const selector = useRef<WalletSelector | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletModalView, setWalletModalView] = useState<'providers' | 'account'>('providers');
  const [walletError, setWalletError] = useState<string | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [connectingId, setConnectingId] = useState<WalletId | null>(null);
  const connecting = useRef(false);
  const signing = useRef(false);
  const confirming = useRef(false);
  const loadWallet = useRef<(() => Promise<void>) | null>(null);

  const confirm = useCallback(async (pending: PendingAction) => {
    if (!pending.txHash || confirming.current) return;
    confirming.current = true;
    setTransaction({ status: 'pending', message: 'Transaction sent. Waiting for NEAR to confirm the result…', hash: pending.txHash });
    try {
      // A wallet redirect is untrusted input. The server checks signer, receiver, method,
      // finality, receipt failures, and the final escrow state before reporting success.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch('/api/transactions/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || result.message || 'Transaction confirmation is unavailable.');
        if (result.status === 'failed' && result.verifiedAction !== true) {
          // A wrong/forged return hash is not proof that the original action
          // failed. Keep its intent and let the user recover the correct hash.
          delete pending.txHash;
          localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
          setTransaction({ status: 'pending', message: `${result.message} Check your wallet activity and recover the original transaction before sending another.` });
          return;
        }
        if (result.status === 'confirmed' || result.status === 'failed') {
          setTransaction({ status: result.status, message: result.message, hash: pending.txHash, bountyId: result.bountyId, method: pending.method });
          localStorage.removeItem(PENDING_KEY);
          window.dispatchEvent(new Event('gitsettle:refresh'));
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      setTransaction({ status: 'pending', message: 'NEAR is still confirming this transaction. Check again before sending another.', hash: pending.txHash });
    } catch (reason) {
      setTransaction({ status: 'pending', message: reason instanceof Error ? reason.message : 'Confirmation is unavailable. Check again shortly.', hash: pending.txHash });
    } finally { confirming.current = false; }
  }, []);

  useEffect(() => {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        if (!response.ok) throw new Error('Wallet configuration could not be loaded. Refresh the page to try again.');
        const current = await response.json() as PublicConfig;
        if (stopped) return;
        setConfig(current);
        if (current.mode === 'demo' || !current.contractId) { setReady(true); return; }
        // Browsing does not need the selector's signing/cryptography bundle.
        // Restore known connections/redirects immediately; otherwise load it
        // only when Connect is requested. Keys below match selector 10.1.4.
        let walletInitialization: Promise<void> | undefined;
        const initializeWallet = () => {
          if (walletInitialization) return walletInitialization;
          walletInitialization = (async () => {
            const { setupGitSettleWallets } = await import('./wallet-modules');
            if (stopped) return;
            const instance = await setupGitSettleWallets(current.rpcUrl);
            if (stopped) return;
            selector.current = instance;
            let previousAccount: string | null = null;
            const update = () => {
              const state = instance.store.getState();
              const nextAccount = state.accounts.find(account => account.active)?.accountId || state.accounts[0]?.accountId || null;
              // Clear the separate private support session on extension-driven
              // changes as well as an explicit disconnect or provider switch.
              if (previousAccount && previousAccount !== nextAccount) window.dispatchEvent(new Event('gitsettle:wallet-disconnected'));
              previousAccount = nextAccount;
              setAccountId(nextAccount);
              setAccounts(state.accounts.map(account => account.accountId).filter(Boolean));
              setSelectedWalletId(state.selectedWalletId);
            };
            update();
            const subscription = instance.store.observable.subscribe(update);
            unsubscribe = () => subscription.unsubscribe();
          })().catch((reason: unknown) => { walletInitialization = undefined; throw reason; });
          return walletInitialization;
        };
        loadWallet.current = initializeWallet;
        // Recover persisted intent before loading any optional wallet chunk.
        // A download/setup failure must never make a sent action disappear.
        const url = new URL(window.location.href);
        const saved = localStorage.getItem(PENDING_KEY);
        if (saved) {
          setTransaction({ status: 'pending', message: 'Recovering your previous wallet request. Do not send it again until its result is checked.' });
          try {
            const pending = JSON.parse(saved) as PendingAction;
            if (!pending || !pending.method || !pending.accountId) throw new Error('Invalid saved request');
            const returnedHash = url.searchParams.get('transactionHashes')?.split(',')[0];
            // An established hash has priority over untrusted redirect parameters.
            if (!pending.txHash && returnedHash) {
              pending.txHash = returnedHash;
              localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
            }
            if (pending.txHash) void confirm(pending);
            else setTransaction({ status: 'pending', message: 'No verified transaction result was returned. Check your wallet activity before sending another request; it may already have been submitted.' });
          } catch {
            setTransaction({ status: 'pending', message: 'The saved wallet request could not be read. Check wallet activity before clearing this request or sending another.' });
          }
          ['transactionHashes', 'errorCode', 'errorMessage'].forEach(key => url.searchParams.delete(key));
          window.history.replaceState({}, '', url.toString());
        }
        const hasWalletState = Boolean(localStorage.getItem('near-wallet-selector:selectedWalletId')
          || localStorage.getItem('near-wallet-selector:selectedWalletId:pending')
          || localStorage.getItem(PENDING_KEY));
        const returning = /[?&#](?:account_id|public_key|transactionHashes|accountId|signature)=/.test(window.location.href);
        if (hasWalletState || returning) await initializeWallet();
        if (stopped) return;
        setReady(true);

      } catch (reason) { if (!stopped) { setError(reason instanceof Error ? reason.message : 'Wallet setup failed.'); setReady(true); } }
    }
    void initialize();
    return () => { stopped = true; unsubscribe?.(); loadWallet.current = null; };
  }, [confirm]);

  const connect = useCallback(() => {
    if (!loadWallet.current) return;
    setError(null); setWalletError(null); setWalletModalView('providers'); setWalletModalOpen(true);
  }, []);
  const manageWallet = useCallback(() => {
    setWalletError(null); setWalletModalView(connecting.current ? 'providers' : 'account'); setWalletModalOpen(true);
  }, []);
  const disconnect = useCallback(async () => {
    if (connecting.current || signing.current) { setError('Finish the current wallet request before disconnecting.'); return; }
    setError(null); setWalletError(null);
    try {
      const wallet = await selector.current?.wallet();
      await wallet?.signOut();
      setAccountId(null); setAccounts([]); setSelectedWalletId(null); setWalletModalOpen(false);
      window.dispatchEvent(new Event('gitsettle:wallet-disconnected'));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not disconnect the wallet.';
      setError(message); setWalletError(message);
    }
  }, []);

  const chooseWallet = useCallback(async (id: WalletId) => {
    const initialize = loadWallet.current;
    if (!initialize || connecting.current || !config?.contractId) return;
    if (signing.current) { setWalletError('Finish the current wallet transaction before switching wallets.'); return; }
    connecting.current = true; setConnectingId(id); setWalletError(null); setError(null);
    // Hide an old private identity while changing providers. Opening the picker
    // alone does not disrupt the active support session.
    setReady(false);
    try {
      await initialize();
      const instance = selector.current;
      if (!instance) throw new Error('Wallet setup was interrupted. Try connecting again.');
      const state = instance.store.getState();
      if (state.selectedWalletId && state.accounts.length) {
        window.dispatchEvent(new Event('gitsettle:wallet-disconnected'));
        await (await instance.wallet()).signOut();
      }
      const wallet = await instance.wallet<InjectedWallet>(id);
      // Sandboxed wallets can render pairing UI in their iframe. Release the
      // native dialog's top layer so that provider-owned UI stays accessible.
      if (id === 'meteor-wallet' || id === 'intear-wallet') setWalletModalOpen(false);
      const connectedAccounts = await wallet.signIn({ contractId: config.contractId });
      if (connectedAccounts.some(account => account.accountId)) setWalletModalOpen(false);
      else throw new Error('No account was returned. Complete the wallet request, then try connecting again.');
    } catch (reason) {
      setWalletError(reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'The wallet connection was not completed. Try again.');
      setWalletModalOpen(true);
    } finally { connecting.current = false; setConnectingId(null); setReady(true); }
  }, [config]);

  const switchAccount = useCallback(async (nextAccount: string) => {
    const instance = selector.current;
    if (connecting.current || signing.current || !instance || !instance.store.getState().accounts.some(account => account.accountId === nextAccount)) return;
    connecting.current = true;
    setConnectingId(walletDefinition(instance.store.getState().selectedWalletId)?.id || null);
    setReady(false); setWalletError(null);
    window.dispatchEvent(new Event('gitsettle:wallet-disconnected'));
    try {
      // Some providers keep an active account in addition to selector state.
      const wallet = await instance.wallet();
      if ('switchAccount' in wallet && typeof wallet.switchAccount === 'function') await wallet.switchAccount(nextAccount);
      instance.setActiveAccount(nextAccount);
    } catch (reason) { setWalletError(reason instanceof Error ? reason.message : 'Could not switch accounts.'); }
    finally { connecting.current = false; setConnectingId(null); setReady(true); }
  }, []);

  const transact = useCallback(async (method: Method, args: Record<string, unknown>, deposit = '0') => {
    if (signing.current) {
      setError('Finish the current wallet signing request before sending a transaction.');
      return;
    }
    if (connecting.current || !ready) {
      setError('Finish connecting or switching your wallet before sending a transaction.');
      return;
    }
    if (!selector.current || !accountId || !config?.contractId || config.mode !== 'testnet') {
      setTransaction({ status: 'failed', message: 'Connect a testnet wallet before sending this transaction.' }); return;
    }
    if (transaction?.status === 'pending' || localStorage.getItem(PENDING_KEY)) {
      setTransaction(current => current?.status === 'pending' ? current : { status: 'pending', message: 'A previous wallet request still needs verification. Check wallet activity before sending another.' });
      return;
    }
    if (selector.current.store.getState().selectedWalletId === 'my-near-wallet' && localStorage.getItem('functionCallKey')) {
      // Earlier app versions requested a limited key from MyNearWallet. Do not
      // silently use or delete it. Disconnect removes the local copy; removing
      // its on-chain permission is a separate action in the user's wallet.
      setTransaction({ status: 'failed', message: 'Your earlier MyNearWallet connection has a saved access key. Disconnect and reconnect to approve each transaction in your wallet. You can revoke the older key in your wallet settings.' });
      return;
    }
    const pending: PendingAction = { method, accountId, bountyId: typeof args.id === 'number' ? args.id : undefined, expectedArgs: args, createdAt: Date.now() };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    setTransaction({ status: 'pending', message: 'Review and sign the transaction in your wallet…' });
    let signingStarted = false;
    signing.current = true;
    try {
      const { actionCreators } = await import('@near-wallet-selector/core');
      const wallet = await selector.current.wallet();
      signingStarted = true;
      const result = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId: config.contractId,
        actions: [actionCreators.functionCall(method, args, 100000000000000n, BigInt(deposit))],
      });
      // Redirect wallets return void. In-page wallets return an execution outcome.
      if (result) {
        pending.txHash = (result as { transaction?: { hash?: string } }).transaction?.hash;
        if (!pending.txHash) throw new Error('The wallet returned no transaction hash. Check wallet activity before retrying.');
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
        void confirm(pending);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'The wallet request was interrupted.';
      if (!signingStarted || /(?:user.{0,20}(?:reject|cancel|denied|declin)|(?:reject|cancel|declin).{0,20}(?:user|request)|UserRejected)/i.test(message)) {
        localStorage.removeItem(PENDING_KEY);
        setTransaction({ status: 'failed', message });
      } else {
        // A timeout can occur after broadcast. Do not automatically retry or
        // label the transfer failed; reconcile the hash with chain receipts.
        setTransaction({ status: 'pending', message: 'The wallet request was interrupted. Check your wallet activity before retrying; the transaction may already have been submitted.' });
      }
    } finally { signing.current = false; }
  }, [accountId, config, ready, transaction?.status, confirm]);

  const clearTransaction = useCallback(() => setTransaction(null), []);
  const retryConfirmation = useCallback(() => {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved) { try { void confirm(JSON.parse(saved) as PendingAction); } catch { setTransaction({ status: 'pending', message: 'The saved request could not be read. Check wallet activity before clearing it.' }); } }
  }, [confirm]);
  const recoverTransaction = useCallback((hash: string) => {
    const saved = localStorage.getItem(PENDING_KEY);
    if (!saved || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash.trim())) return;
    try {
      const pending = { ...JSON.parse(saved), txHash: hash.trim() } as PendingAction;
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      void confirm(pending);
    } catch { setTransaction({ status: 'pending', message: 'The saved request could not be read. Check wallet activity before clearing it.' }); }
  }, [confirm]);
  const dismissUnsent = useCallback(() => {
    localStorage.removeItem(PENDING_KEY);
    setTransaction({ status: 'failed', message: 'Pending request cleared after your wallet check. Your draft is preserved.' });
  }, []);
  const signAuthMessage = useCallback(async (params: SignMessageParams) => {
    if (connecting.current || !ready) throw new Error('Finish switching wallets before signing in to support.');
    if (signing.current) throw new Error('Finish the current wallet signing request before signing in to support.');
    const instance = selector.current;
    if (!instance || !accountId) throw new Error('Connect your NEAR wallet before signing in to support.');
    const state = instance.store.getState();
    const activeAccount = state.accounts.find(account => account.active)?.accountId || state.accounts[0]?.accountId;
    if (activeAccount !== accountId) throw new Error('Your wallet account changed. Wait for the new account, then sign in again.');
    const providerId = state.selectedWalletId;
    const selected = walletDefinition(providerId);
    if (selected && !selected.support) throw new Error(`${selected.name}'s current adapter cannot sign the complete support challenge. Switch to MyNearWallet, Meteor Wallet, or Nightly for private support.`);
    signing.current = true;
    try {
      const wallet = await instance.wallet();
      if (!wallet.signMessage) throw new Error('This wallet does not support message signing. Use a wallet with NEP-413 support to open a private ticket.');
      // Keep the provider stable while its message window is open. Extension-
      // driven account changes remain possible, so discard their stale result.
      const result = await wallet.signMessage(params);
      const nextState = instance.store.getState();
      const nextAccount = nextState.accounts.find(account => account.active)?.accountId || nextState.accounts[0]?.accountId;
      if (nextState.selectedWalletId !== providerId || nextAccount !== accountId || (result && result.accountId !== accountId)) {
        throw new Error('Your wallet account changed during signing. Sign in again with the active account.');
      }
      return result;
    } finally { signing.current = false; }
  }, [accountId, ready]);

  return <WalletContext.Provider value={{ config, accountId, ready, error, transaction, connect, manageWallet, walletName: walletDefinition(selectedWalletId)?.name || null, connectionPending: Boolean(connectingId), disconnect, transact, clearTransaction, retryConfirmation, recoverTransaction, dismissUnsent, signAuthMessage }}>{children}<WalletModal open={walletModalOpen} view={walletModalView} accountId={accountId} accounts={accounts} selectedWalletId={selectedWalletId} connectingId={connectingId} error={walletError} onClose={() => setWalletModalOpen(false)} onChoose={id => { void chooseWallet(id); }} onSwitch={() => { setWalletError(null); setWalletModalView('providers'); }} onDisconnect={() => { void disconnect(); }} onAccount={id => { void switchAccount(id); }} /></WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be inside WalletProvider.');
  return value;
}
