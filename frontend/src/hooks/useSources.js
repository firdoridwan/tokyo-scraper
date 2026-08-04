import { useCallback } from 'react';
import { sourcesApi } from '@/api/services/sources.api.js';
import { useApiQuery } from './useApiQuery.js';

/** All registered directory sources. */
export function useSources() {
  const queryFn = useCallback((options) => sourcesApi.list(options), []);
  const query = useApiQuery(queryFn, [], { initialData: [] });

  return { ...query, sources: query.data ?? [] };
}

/** One source descriptor — drives the dynamic scrape form. */
export function useSource(sourceId) {
  const queryFn = useCallback(
    (options) => sourcesApi.getById(sourceId, options),
    [sourceId],
  );

  const query = useApiQuery(queryFn, [sourceId], { enabled: Boolean(sourceId) });

  return { ...query, source: query.data ?? null };
}
