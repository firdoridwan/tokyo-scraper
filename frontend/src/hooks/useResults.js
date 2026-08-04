import { useCallback } from 'react';
import { resultsApi } from '@/api/services/results.api.js';
import { jobsApi } from '@/api/services/jobs.api.js';
import { useApiQuery } from './useApiQuery.js';

/** Extracted rows, optionally scoped to a single job. */
export function useResults(filters = {}) {
  const { page, pageSize, jobId, sourceId, search } = filters;

  const queryFn = useCallback(
    (options) =>
      jobId
        ? jobsApi.results(jobId, { page, pageSize, search }, options)
        : resultsApi.list({ page, pageSize, sourceId, search }, options),
    [page, pageSize, jobId, sourceId, search],
  );

  const query = useApiQuery(queryFn, [page, pageSize, jobId, sourceId, search], {
    initialData: [],
  });

  return {
    ...query,
    results: query.data ?? [],
    pagination: query.meta?.pagination ?? null,
  };
}

export default useResults;
