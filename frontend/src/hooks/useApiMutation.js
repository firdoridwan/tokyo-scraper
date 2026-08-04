import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Write hook: runs on explicit call, never on render.
 *
 * Guarantees `isPending` is accurate even if the component unmounts mid-flight,
 * and returns the result so callers can navigate on success without threading
 * state through an effect.
 *
 * @param {(variables: unknown) => Promise<{ data: unknown }>} mutationFn
 * @param {{ onSuccess?: (data: unknown) => void, onError?: (error: unknown) => void }} [callbacks]
 */
export function useApiMutation(mutationFn, { onSuccess, onError } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isPending, setIsPending] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (variables) => {
      setIsPending(true);
      setError(null);

      try {
        const response = await mutationFn(variables);
        const result = response?.data ?? null;
        if (mountedRef.current) setData(result);
        onSuccess?.(result);
        return { ok: true, data: result };
      } catch (caught) {
        if (mountedRef.current) setError(caught);
        onError?.(caught);
        return { ok: false, error: caught };
      } finally {
        if (mountedRef.current) setIsPending(false);
      }
    },
    [mutationFn, onSuccess, onError],
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsPending(false);
  }, []);

  return { mutate, reset, data, error, isPending };
}

export default useApiMutation;
