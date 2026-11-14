'use client';

import { useCallback, useEffect, useState } from 'react';
import { communityRequest } from '@/components/community-provider';

/** Keep private polling responses scoped to the authenticated account. */
export function usePrivateData<T>(url: string | null, account: string | null, interval = 15_000) {
  const scope = `${account || ''}:${url || ''}`;
  const [state, setState] = useState<{ scope: string; data: T | null; loading: boolean; error: string | null }>({ scope: '', data: null, loading: Boolean(url && account), error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!url || !account) { setState({ scope, data: null, loading: false, error: null }); return; }
    const controller = new AbortController();
    setState((previous) => previous.scope === scope ? { ...previous, loading: true } : { scope, data: null, loading: true, error: null });
    void communityRequest<T>(url, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setState({ scope, data: result, loading: false, error: null });
    }).catch((reason) => { if (!controller.signal.aborted) setState((previous) => ({ scope, data: previous.scope === scope ? previous.data : null, loading: false, error: reason instanceof Error ? reason.message : 'This conversation could not be loaded.' })); });
    return () => controller.abort();
  }, [url, account, scope, revision]);
  useEffect(() => {
    if (!url || !account) return;
    const timer = window.setInterval(refresh, interval);
    return () => window.clearInterval(timer);
  }, [url, account, interval, refresh]);
  // Scope the return synchronously: effects run after paint, so clearing only
  // inside an effect could briefly show the previous account's private thread.
  return state.scope === scope ? { data: state.data, error: state.error, loading: state.loading, refresh } : { data: null, error: null, loading: Boolean(url && account), refresh };
}

export function messageDate(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
}
