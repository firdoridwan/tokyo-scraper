import { useCallback, useEffect, useRef } from 'react';
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
