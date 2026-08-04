import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/** Scrape job lifecycle. */
export const jobsApi = {
  /** Called by the "Start Scraping" button. */
  create: (payload, options) => http.post(endpoints.jobs.create(), payload, options),

  list: (query, options) => http.get(endpoints.jobs.list(), { ...options, query }),
  getById: (id, options) => http.get(endpoints.jobs.detail(id), options),
  cancel: (id, options) => http.post(endpoints.jobs.cancel(id), undefined, options),
  remove: (id, options) => http.delete(endpoints.jobs.remove(id), options),
  results: (id, query, options) => http.get(endpoints.jobs.results(id), { ...options, query }),
};

export default jobsApi;
