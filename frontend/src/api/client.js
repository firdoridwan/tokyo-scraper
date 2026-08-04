/**
 * HTTP client.
 *
 * The only module in the frontend that knows about `fetch`, URLs, headers, or
 * the response envelope. Everything above it deals in plain data and a single
 * `ApiError` type — so swapping in axios, adding auth headers, or introducing
 * retries is a change to this file alone.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const DEFAULT_TIMEOUT_MS = 20_000;

/** Error carrying the backend's machine-readable code and details. */
export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code ?? 'NETWORK_ERROR';
    this.details = details;
  }

  /** True when the request never reached the server. */
  get isNetworkError() {
    return this.status === 0;
  }

  /** True for endpoints that exist but aren't built yet (501). */
  get isNotImplemented() {
    return this.status === 501;
  }
}

/** Drops empty values so we never send `?status=&page=1`. */
function buildUrl(path, query) {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }

  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: object, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Timeout and caller cancellation both need to abort the same request.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError' && signal?.aborted) throw error; // caller cancelled
    throw new ApiError(
      'Cannot reach the Tokyo Scraper API. Is the backend running?',
      { status: 0, code: 'NETWORK_ERROR', details: { cause: String(error?.message ?? error) } },
    );
  }
  clearTimeout(timeoutId);

  // 204 and other empty bodies are legitimate; don't try to parse them.
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(error?.message ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: error?.code ?? 'HTTP_ERROR',
      details: error?.details,
    });
  }

  // Unwrap the envelope once, here — components receive plain data + meta.
  return { data: payload?.data ?? null, meta: payload?.meta ?? null };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const http = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default http;
