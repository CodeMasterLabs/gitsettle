'use client';

import { useCallback, useEffect, useState } from 'react';

/** Fetch read-only server data; a confirmed wallet transaction refreshes every mounted view. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    async function load() {
      try {
        const response = await fetch(url!, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || payload.message || 'The request could not be completed.');
        setData(payload as T);
        setError(null);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The request could not be completed.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [url, revision]);

  useEffect(() => {
    window.addEventListener('gitsettle:refresh', retry);
    const timer = window.setInterval(retry, 30_000);
    return () => { window.removeEventListener('gitsettle:refresh', retry); window.clearInterval(timer); };
  }, [retry]);

  return { data, error, loading, retry };
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
