import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Read hook: runs a request on mount and whenever `deps` change.
 *
 * A deliberately small alternative to TanStack Query — this app's read pattern
 * is "fetch, show, refetch on demand". If caching or background revalidation
 * becomes a requirement, replacing this one hook is the whole migration.
 *
 * Handles the three things that are easy to get wrong by hand:
 *   - aborting the in-flight request when deps change or the component unmounts
 *   - never calling setState after unmount
 *   - keeping the previous data visible while refetching (no flash of empty)
 *
 * @param {(options: { signal: AbortSignal }) => Promise<{ data: unknown, meta: unknown }>} queryFn
 * @param {unknown[]} deps
 * @param {{ enabled?: boolean, initialData?: unknown }} [options]
 */
export function useApiQuery(queryFn, deps = [], { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isRefetching, setIsRefetching] = useState(false);

  const mountedRef = useRef(true);
  const abortRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const execute = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (hasLoadedRef.current) setIsRefetching(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await queryFnRef.current({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setData(response?.data ?? null);
      setMeta(response?.meta ?? null);
      hasLoadedRef.current = true;
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (caught?.name === 'AbortError') return;
      setError(caught);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, execute, ...deps]);

  return { data, meta, error, isLoading, isRefetching, refetch: execute };
}

export default useApiQuery;
