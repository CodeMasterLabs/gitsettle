'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SignMessageParams, SignedMessage, WalletSelector } from '@near-wallet-selector/core';
import type { WalletSelectorModal } from '@near-wallet-selector/modal-ui';
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
  transaction: Transaction | null; connect: () => void; disconnect: () => Promise<void>;
  transact: (method: Method, args: Record<string, unknown>, deposit?: string) => Promise<void>;
  clearTransaction: () => void; retryConfirmation: () => void;
  recoverTransaction: (hash: string) => void; dismissUnsent: () => void;
  signAuthMessage: (params: SignMessageParams) => Promise<SignedMessage | void>;
};
const WalletContext = createContext<WalletContextValue | null>(null);
const PENDING_KEY = 'gitsettle.pending.v1';

/** Wallet keys remain inside the wallet. Only unsigned action metadata is kept across redirects. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const selector = useRef<WalletSelector | null>(null);
  const modal = useRef<WalletSelectorModal | null>(null);
  const confirming = useRef(false);

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
        const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }] = await Promise.all([
          import('@near-wallet-selector/core'), import('@near-wallet-selector/modal-ui'), import('@near-wallet-selector/my-near-wallet'),
        ]);
        const instance = await setupWalletSelector({ network: 'testnet', modules: [setupMyNearWallet()] });
        if (stopped) return;
        selector.current = instance;
        modal.current = setupModal(instance, { contractId: current.contractId, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' });
        const update = () => {
          const state = instance.store.getState();
          setAccountId(state.accounts.find((account) => account.active)?.accountId || state.accounts[0]?.accountId || null);
        };
        update();
        const subscription = instance.store.observable.subscribe(update);
        unsubscribe = () => subscription.unsubscribe();
        setReady(true);
        const url = new URL(window.location.href);
        const saved = localStorage.getItem(PENDING_KEY);
        if (saved) {
          const pending = JSON.parse(saved) as PendingAction;
          const hashes = url.searchParams.get('transactionHashes');
          const walletError = url.searchParams.get('errorCode');
          if (walletError) {
            localStorage.removeItem(PENDING_KEY);
            setTransaction({ status: 'failed', message: 'The wallet did not complete the transaction. Your input has been preserved.' });
          } else if (hashes) {
            pending.txHash = hashes.split(',')[0];
            localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
            void confirm(pending);
          } else if (pending.txHash) {
            void confirm(pending);
          } else {
            // Losing a redirect does not prove that broadcasting failed. Preserve
            // the original action until the user can reconcile wallet activity.
            setTransaction({ status: 'pending', message: 'No transaction result was returned. Check your wallet activity before sending another request; it may already have been submitted.' });
          }
          ['transactionHashes', 'errorCode', 'errorMessage'].forEach((key) => url.searchParams.delete(key));
          window.history.replaceState({}, '', url.toString());
        }
      } catch (reason) { if (!stopped) { setError(reason instanceof Error ? reason.message : 'Wallet setup failed.'); setReady(true); } }
    }
    void initialize();
    return () => { stopped = true; unsubscribe?.(); };
  }, [confirm]);

  const connect = useCallback(() => modal.current?.show(), []);
  const disconnect = useCallback(async () => {
    try { const wallet = await selector.current?.wallet(); await wallet?.signOut(); setAccountId(null); window.dispatchEvent(new Event('gitsettle:wallet-disconnected')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not disconnect the wallet.'); }
  }, []);

  const transact = useCallback(async (method: Method, args: Record<string, unknown>, deposit = '0') => {
    if (!selector.current || !accountId || !config?.contractId || config.mode !== 'testnet') {
      setTransaction({ status: 'failed', message: 'Connect a testnet wallet before sending this transaction.' }); return;
    }
    if (transaction?.status === 'pending') return;
    const pending: PendingAction = { method, accountId, bountyId: typeof args.id === 'number' ? args.id : undefined, expectedArgs: args, createdAt: Date.now() };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    setTransaction({ status: 'pending', message: 'Review and sign the transaction in your wallet…' });
    let signingStarted = false;
    try {
      const { actionCreators } = await import('@near-wallet-selector/core');
      const wallet = await selector.current.wallet();
      signingStarted = true;
      const result = await wallet.signAndSendTransaction({
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
      const message = reason instanceof Error ? reason.message : 'The wallet request was interrupted.';
      if (!signingStarted || /(?:user.{0,20}(?:reject|cancel|denied|declin)|(?:reject|cancel|declin).{0,20}(?:user|request)|UserRejected)/i.test(message)) {
        localStorage.removeItem(PENDING_KEY);
        setTransaction({ status: 'failed', message });
      } else {
        // A timeout can occur after broadcast. Do not automatically retry or
        // label the transfer failed; reconcile the hash with chain receipts.
        setTransaction({ status: 'pending', message: 'The wallet request was interrupted. Check your wallet activity before retrying; the transaction may already have been submitted.' });
      }
    }
  }, [accountId, config, transaction?.status, confirm]);

  const clearTransaction = useCallback(() => setTransaction(null), []);
  const retryConfirmation = useCallback(() => {
    const saved = localStorage.getItem(PENDING_KEY);
    if (saved) void confirm(JSON.parse(saved) as PendingAction);
  }, [confirm]);
  const recoverTransaction = useCallback((hash: string) => {
    const saved = localStorage.getItem(PENDING_KEY);
    if (!saved || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash.trim())) return;
    const pending = { ...JSON.parse(saved), txHash: hash.trim() } as PendingAction;
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    void confirm(pending);
  }, [confirm]);
  const dismissUnsent = useCallback(() => {
    localStorage.removeItem(PENDING_KEY);
    setTransaction({ status: 'failed', message: 'Pending request cleared after your wallet check. Your draft is preserved.' });
  }, []);
  const signAuthMessage = useCallback(async (params: SignMessageParams) => {
    if (!selector.current || !accountId) throw new Error('Connect your NEAR wallet before signing in to support.');
    const wallet = await selector.current.wallet();
    if (!wallet.signMessage) throw new Error('This wallet does not support message signing. Use a wallet with NEP-413 support to open a private ticket.');
    // Message signing proves account control for a short-lived web session. It
    // does not call the escrow contract, spend tokens, or share transaction state.
    return wallet.signMessage(params);
  }, [accountId]);

  return <WalletContext.Provider value={{ config, accountId, ready, error, transaction, connect, disconnect, transact, clearTransaction, retryConfirmation, recoverTransaction, dismissUnsent, signAuthMessage }}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be inside WalletProvider.');
  return value;
}
