import { useCallback, useEffect, useRef, useState } from 'react';
import { systemApi } from '@/api/services/system.api.js';
import { useApiQuery } from './useApiQuery.js';

/**
 * API connectivity indicator shown in the top bar.
 *
 * Polls on an interval so a backend restart is reflected without a page reload.
 */
export function useApiHealth({ pollMs = 15_000 } = {}) {
  const queryFn = useCallback((options) => systemApi.health(options), []);
  const query = useApiQuery(queryFn, []);
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  useEffect(() => {
    if (!pollMs) return undefined;
    const id = setInterval(() => refetchRef.current(), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  return {
    ...query,
    health: query.data ?? null,
    isOnline: Boolean(query.data) && !query.error,
  };
}

/** Aggregate counters for the dashboard tiles. */
export function useStats() {
  const queryFn = useCallback((options) => systemApi.stats(options), []);
  const query = useApiQuery(queryFn, []);
  return { ...query, stats: query.data ?? null };
}

/** Small helper for transient inline confirmations ("Job queued"). */
export function useTransientMessage(timeoutMs = 6000) {
  const [message, setMessage] = useState(null);
  const timerRef = useRef(null);

  const show = useCallback(
    (next) => {
      clearTimeout(timerRef.current);
      setMessage(next);
      timerRef.current = setTimeout(() => setMessage(null), timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { message, show, clear: () => setMessage(null) };
}
