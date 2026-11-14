'use client';

import { Buffer } from 'buffer';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWallet } from './wallet-provider';

export interface CommunitySession { accountId: string; expiresAt: string; isAdmin: boolean }
interface AuthChallenge { challengeId: string; state: string; message: string; nonce: string; recipient: string; callbackUrl: string; expiresAt: string }
type AuthStatus = 'loading' | 'signed_out' | 'signing' | 'authenticated';
interface CommunityContextValue {
  session: CommunitySession | null; status: AuthStatus; error: string | null;
  authenticate: () => Promise<void>; logout: () => Promise<void>; refreshSession: () => Promise<void>;
}
const CommunityContext = createContext<CommunityContextValue | null>(null);
const AUTH_KEY = 'gitsettle.auth.v1';

/** Read structured private API errors without exposing provider details or credentials. */
export async function communityRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('gitsettle:session-expired'));
    throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || 'This request could not be completed.');
  }
  return payload as T;
}

/** A server-verified NEP-413 signature establishes an HttpOnly session for private support. */
export function CommunityProvider({ children }: { children: ReactNode }) {
  const { accountId, ready, signAuthMessage } = useWallet();
  const [session, setSession] = useState<CommunitySession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  // Wallet/account changes invalidate every older HTTP and signature response.
  // Keep one sign-in operation active until stale-session cleanup has completed.
  const authGeneration = useRef(0);
  const authenticating = useRef(false);

  const refreshSession = useCallback(async () => {
    const generation = authGeneration.current;
    try {
      const result = await communityRequest<{ session: CommunitySession | null }>('/api/auth/session');
      if (generation !== authGeneration.current) return;
      setSession(result.session); setStatus(result.session ? 'authenticated' : 'signed_out');
    } catch (reason) {
      if (generation !== authGeneration.current) return;
      setSession(null); setError(reason instanceof Error ? reason.message : 'Support sign-in could not be checked.'); setStatus('signed_out');
    }
  }, []);

  const establish = useCallback(async (signed: { challengeId: string; accountId: string; publicKey: string; signature: string }, generation: number) => {
    if (generation !== authGeneration.current) return false;
    const result = await communityRequest<{ session: CommunitySession }>('/api/auth/session', { method: 'POST', body: JSON.stringify(signed) });
    if (generation !== authGeneration.current) {
      // The response may have set its HttpOnly cookie after an earlier logout.
      // Revoke it before permitting another sign-in; never paint stale identity.
      try { await communityRequest('/api/auth/session', { method: 'DELETE' }); }
      catch { setError('Server sign-out failed after the cancelled sign-in. Retry sign-out before leaving this browser.'); }
      return false;
    }
    sessionStorage.removeItem(AUTH_KEY);
    setSession(result.session); setStatus('authenticated'); setError(null);
    return true;
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    async function initialize() {
      // My NEAR Wallet can return NEP-413 signatures in a URL fragment. Scrub
      // immediately, then let the server validate all fields against its cookie.
      const url = new URL(window.location.href);
      const fragment = new URLSearchParams(url.hash.slice(1));
      const signature = fragment.get('signature');
      if (signature || fragment.has('publicKey')) {
        url.hash = '';
        window.history.replaceState({}, '', url.toString());
        const saved = sessionStorage.getItem(AUTH_KEY);
        let pending: { challengeId: string; accountId: string; returnTo?: string } | null = null;
        try { pending = saved ? JSON.parse(saved) : null; } catch { /* A stale browser draft is not valid authentication evidence. */ }
        const state = fragment.get('state');
        if (!pending || state !== pending.challengeId || fragment.get('accountId') !== pending.accountId || !signature || !fragment.get('publicKey')) {
          sessionStorage.removeItem(AUTH_KEY); setError('The wallet sign-in response did not match this browser’s request. Sign in again.'); setStatus('signed_out'); return;
        }
        setStatus('signing');
        const generation = ++authGeneration.current;
        authenticating.current = true;
        try {
          const established = await establish({ challengeId: state, accountId: pending.accountId, publicKey: fragment.get('publicKey')!, signature }, generation);
          if (established && pending.returnTo) {
            const destination = new URL(pending.returnTo, window.location.origin);
            if (destination.origin === window.location.origin && destination.pathname !== '/support') window.location.replace(destination.href);
          }
        }
        catch (reason) {
          if (generation === authGeneration.current) { sessionStorage.removeItem(AUTH_KEY); setError(reason instanceof Error ? reason.message : 'The wallet signature could not be verified.'); setStatus('signed_out'); }
        }
        finally { authenticating.current = false; }
        return;
      }
      if ((fragment.has('error') || fragment.has('errorCode')) && sessionStorage.getItem(AUTH_KEY)) {
        let expectedState: string | undefined;
        try { expectedState = JSON.parse(sessionStorage.getItem(AUTH_KEY)!).challengeId; } catch { /* Do not trust damaged pending metadata. */ }
        const returnedState = fragment.get('state');
        url.hash = ''; window.history.replaceState({}, '', url.toString()); sessionStorage.removeItem(AUTH_KEY);
        setError(returnedState && returnedState !== expectedState ? 'The wallet response did not match this sign-in request. Sign in again.' : 'The wallet did not complete the sign-in message. You can try again without spending tokens.');
        setStatus('signed_out'); return;
      }
      await refreshSession();
    }
    void initialize();
  }, [establish, refreshSession]);

  const logout = useCallback(async () => {
    const generation = ++authGeneration.current;
    sessionStorage.removeItem(AUTH_KEY); setSession(null); setStatus('signed_out'); setError(null);
    try {
      await communityRequest('/api/auth/session', { method: 'DELETE' });
    } catch {
      if (generation !== authGeneration.current) return;
      setError('Server sign-out failed. Your support session may still be active; retry sign-out before leaving this browser.');
    }
  }, []);

  useEffect(() => {
    const expired = () => { authGeneration.current += 1; sessionStorage.removeItem(AUTH_KEY); setSession(null); setStatus('signed_out'); setError('Your support session expired. Sign a fresh message to continue.'); };
    const disconnected = () => { void logout(); };
    window.addEventListener('gitsettle:session-expired', expired);
    window.addEventListener('gitsettle:wallet-disconnected', disconnected);
    return () => { window.removeEventListener('gitsettle:session-expired', expired); window.removeEventListener('gitsettle:wallet-disconnected', disconnected); };
  }, [logout]);

  useEffect(() => {
    if (ready && accountId && session && accountId !== session.accountId) void logout();
  }, [accountId, ready, session, logout]);

  const authenticate = useCallback(async () => {
    if (!accountId) { setError('Connect your wallet before signing in to support.'); return; }
    if (authenticating.current) { setError('Finish the previous support sign-in request before trying again.'); return; }
    authenticating.current = true;
    const generation = ++authGeneration.current;
    setError(null); setStatus('signing');
    try {
      const { challenge } = await communityRequest<{ challenge: AuthChallenge }>('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ accountId }) });
      if (generation !== authGeneration.current) return;
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ challengeId: challenge.challengeId, accountId, returnTo: `${window.location.pathname}${window.location.search}` }));
      const result = await signAuthMessage({ message: challenge.message, nonce: Buffer.from(challenge.nonce, 'base64'), recipient: challenge.recipient, callbackUrl: challenge.callbackUrl, state: challenge.state });
      if (generation !== authGeneration.current) return;
      if (result) await establish({ challengeId: challenge.challengeId, accountId: result.accountId, publicKey: result.publicKey, signature: result.signature }, generation);
      // A redirecting wallet returns void. The independent callback above owns
      // verification; no signature or session token is saved in localStorage.
    } catch (reason) {
      if (generation !== authGeneration.current) return;
      sessionStorage.removeItem(AUTH_KEY); setStatus('signed_out');
      setError(reason instanceof Error ? reason.message : 'The support sign-in message was not completed.');
    } finally { authenticating.current = false; }
  }, [accountId, establish, signAuthMessage]);

  // Do not paint a previous wallet's private session while the wallet selector
  // is restoring identity or switching accounts. The cookie remains server owned.
  const visibleSession = ready && (!accountId || accountId === session?.accountId) ? session : null;
  const visibleStatus = !ready ? 'loading' : session && accountId && session.accountId !== accountId ? 'signed_out' : status;
  return <CommunityContext.Provider value={{ session: visibleSession, status: visibleStatus, error, authenticate, logout, refreshSession }}>{children}</CommunityContext.Provider>;
}

export function useCommunity() {
  const context = useContext(CommunityContext);
  if (!context) throw new Error('useCommunity must be inside CommunityProvider.');
  return context;
}
