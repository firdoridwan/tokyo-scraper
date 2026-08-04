import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/** Extracted business records. */
export const resultsApi = {
  list: (query, options) => http.get(endpoints.results.list(), { ...options, query }),

  /** Reserved — the backend answers 501 until the exporter is built. */
  export: (query, options) => http.get(endpoints.results.export(), { ...options, query }),
};

export default resultsApi;
