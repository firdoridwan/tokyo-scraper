import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/**
 * A run holds its request open until the scrape finishes — no queue, no
 * polling — so this one call needs far longer than the client's 20s default.
 * Roughly ten seconds per company, plus discovery.
 */
const RUN_TIMEOUT_MS = 10 * 60_000;

/** Scrape job lifecycle. */
export const jobsApi = {
  /** Called by the "Start Scraping" button. Resolves when the run is done. */
  create: (payload, options) =>
    http.post(endpoints.jobs.create(), payload, { timeoutMs: RUN_TIMEOUT_MS, ...options }),

  list: (query, options) => http.get(endpoints.jobs.list(), { ...options, query }),
  getById: (id, options) => http.get(endpoints.jobs.detail(id), options),
  cancel: (id, options) => http.post(endpoints.jobs.cancel(id), undefined, options),
  remove: (id, options) => http.delete(endpoints.jobs.remove(id), options),
  results: (id, query, options) => http.get(endpoints.jobs.results(id), { ...options, query }),
};

export default jobsApi;
