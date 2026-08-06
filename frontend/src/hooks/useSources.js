import { useCallback } from 'react';
import { sourcesApi } from '@/api/services/sources.api.js';
import { useApiQuery } from './useApiQuery.js';

/** All registered directory sources. */
export function useSources() {
  const queryFn = useCallback((options) => sourcesApi.list(options), []);
  const query = useApiQuery(queryFn, [], { initialData: [] });

  return { ...query, sources: query.data ?? [] };
}
