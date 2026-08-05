import { useCallback, useEffect, useState } from 'react';
import { jobsApi } from '@/api/services/jobs.api.js';
import { isTerminalStatus } from '@/lib/constants.js';
import { useApiQuery } from './useApiQuery.js';
import { useApiMutation } from './useApiMutation.js';

/** How often a running job is re-read. */
const POLL_INTERVAL_MS = 2000;

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

/**
 * Follows one job until it finishes.
 *
 * The backend accepts a job and runs it in the background, so the only way to
 * learn what happened is to ask again. This asks every two seconds and stops
 * the moment the job reaches a terminal state.
 *
 * A self-scheduling `setTimeout` chain, not `setInterval`: the next request is
 * only queued once the previous one has come back. With an interval, a run
 * whose response takes longer than the gap would stack requests on a server
 * that is already busy scraping — and the stop condition would race with
 * whatever was already in flight.
 *
 * Passing `null` polls nothing, which is the state before the first job.
 *
 * @param {string|null} jobId
 * @returns {{ job: object|null, error: unknown, isPolling: boolean }}
 */
export function useJobPolling(jobId) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    setJob(null);
    setError(null);

    if (!jobId) {
      setIsPolling(false);
      return undefined;
    }

    let stopped = false;
    let timer = null;
    const controller = new AbortController();
    setIsPolling(true);

    const poll = async () => {
      try {
        const { data } = await jobsApi.getById(jobId, { signal: controller.signal });
        if (stopped) return;

        setJob(data);
        setError(null);

        // The one condition that ends the loop for good.
        if (isTerminalStatus(data?.status)) {
          setIsPolling(false);
          return;
        }
      } catch (caught) {
        if (stopped || caught?.name === 'AbortError') return;
        // A blip mid-run must not abandon a scrape that is still going: the
        // error is surfaced and the next tick is still scheduled, so polling
        // recovers by itself when the API answers again.
        setError(caught);
      }

      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId]);

  return { job, error, isPolling };
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
