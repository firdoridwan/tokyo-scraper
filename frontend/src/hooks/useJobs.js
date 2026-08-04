import { useCallback } from 'react';
import { jobsApi } from '@/api/services/jobs.api.js';
import { useApiQuery } from './useApiQuery.js';
import { useApiMutation } from './useApiMutation.js';

/**
 * Paginated job list.
 * @param {{ page?: number, pageSize?: number, status?: string, sourceId?: string }} filters
 */
export function useJobs(filters = {}) {
  const { page, pageSize, status, sourceId } = filters;

  const queryFn = useCallback(
    (options) => jobsApi.list({ page, pageSize, status, sourceId }, options),
    [page, pageSize, status, sourceId],
  );

  const query = useApiQuery(queryFn, [page, pageSize, status, sourceId], { initialData: [] });

  return {
    ...query,
    jobs: query.data ?? [],
    pagination: query.meta?.pagination ?? null,
  };
}

/** A single job. */
export function useJob(jobId) {
  const queryFn = useCallback((options) => jobsApi.getById(jobId, options), [jobId]);
  const query = useApiQuery(queryFn, [jobId], { enabled: Boolean(jobId) });

  return { ...query, job: query.data ?? null };
}

/** Creates a job — this is what "Start Scraping" calls. */
export function useCreateJob(callbacks) {
  const mutationFn = useCallback((payload) => jobsApi.create(payload), []);
  return useApiMutation(mutationFn, callbacks);
}

export function useCancelJob(callbacks) {
  const mutationFn = useCallback((jobId) => jobsApi.cancel(jobId), []);
  return useApiMutation(mutationFn, callbacks);
}

export function useDeleteJob(callbacks) {
  const mutationFn = useCallback((jobId) => jobsApi.remove(jobId), []);
  return useApiMutation(mutationFn, callbacks);
}
