import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/**
 * Scrape job lifecycle.
 *
 * Every call here is a short request. `create()` used to be the exception — it
 * held its socket open for the whole scrape and carried a ten-minute timeout to
 * survive it — but a run has been a background job since the API started
 * answering with a `queued` record instead of a finished one. The long timeout
 * outlived its reason and became a liability: a backend that stalled left the
 * button spinning for ten minutes before the client gave up. The default
 * applies again, so a stalled start fails while the user is still watching.
 */
export const jobsApi = {
  /**
   * Called by the "Start Scraping" button. Resolves as soon as the job is
   * accepted — not when the scrape finishes. Follow it with `getById`.
   */
  create: (payload, options) => http.post(endpoints.jobs.create(), payload, options),

  list: (query, options) => http.get(endpoints.jobs.list(), { ...options, query }),
  getById: (id, options) => http.get(endpoints.jobs.detail(id), options),
  cancel: (id, options) => http.post(endpoints.jobs.cancel(id), undefined, options),
  remove: (id, options) => http.delete(endpoints.jobs.remove(id), options),
  results: (id, query, options) => http.get(endpoints.jobs.results(id), { ...options, query }),
};

export default jobsApi;
