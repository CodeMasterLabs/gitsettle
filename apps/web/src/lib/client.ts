'use client';

import { useCallback, useEffect, useState } from 'react';
import { PublicViewCache } from './public-cache';

/** Public GETs share a tiny navigation cache; private support/AI never enter it. */
const publicViews = new PublicViewCache(async (url) => {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || 'The request could not be completed.');
  return payload;
});

/** Keep mounted content stable while refreshing; a changed URL never inherits another account's data. */
export function useApi<T>(url: string | null) {
  const [resource, setResource] = useState<{ url: string | null; data: T | null; error: string | null; loading: boolean; refreshing: boolean }>(() => {
    const data = url ? publicViews.peek<T>(url) : null;
    return { url, data, error: null, loading: Boolean(url) && !data, refreshing: false };
  });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => {
    if (url) publicViews.invalidate(url);
    setRevision(value => value + 1);
  }, [url]);

  useEffect(() => {
    let active = true;
    if (!url) {
      setResource({ url, data: null, error: null, loading: false, refreshing: false });
      return;
    }
    setResource(previous => {
      const data = previous.url === url ? previous.data : publicViews.peek<T>(url);
      return { url, data, error: null, loading: !data, refreshing: true };
    });
    void publicViews.read<T>(url).then(data => {
      if (active) setResource({ url, data, error: null, loading: false, refreshing: false });
    }).catch((reason: unknown) => {
      // An upstream outage must not leave stale balances presented as current.
      if (active) setResource({ url, data: null, error: reason instanceof Error ? reason.message : 'The request could not be completed.', loading: false, refreshing: false });
    });
    // Let the shared read finish for other mounted consumers/navigation, but stop
    // this component receiving it after a route change or invalidating refresh.
    return () => { active = false; };
  }, [url, revision]);

  useEffect(() => {
    const confirmed = () => { publicViews.invalidate(); setRevision(value => value + 1); };
    const visible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('gitsettle:refresh', confirmed);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 30_000);
    return () => {
      window.removeEventListener('gitsettle:refresh', confirmed);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(timer);
    };
  }, [retry]);

  const matches = resource.url === url;
  const data = matches ? resource.data : url ? publicViews.peek<T>(url) : null;
  return { data, error: matches ? resource.error : null, loading: matches ? resource.loading : Boolean(url) && !data, refreshing: matches && resource.refreshing, retry };
}

export function dateLabel(seconds: number, withTime = false) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  }).format(new Date(seconds * 1000)) + (withTime ? ' UTC' : '');
}

export function shortAccount(account: string) {
  return account.length > 29 ? `${account.slice(0, 16)}…${account.slice(-9)}` : account;
}

export function issueNumber(url: string) { return url.split('/').at(-1) || ''; }
