import { apiUrl, http } from '../client.js';
import { endpoints } from '../endpoints.js';

/** Extracted business records. */
export const resultsApi = {
  list: (query, options) => http.get(endpoints.results.list(), { ...options, query }),

  export: (query, options) => http.get(endpoints.results.export(), { ...options, query }),

  /**
   * Href for one of a completed job's export files.
   *
   * A link, not a request: the response is a file, and letting the browser
   * navigate to it is what triggers its own download handling.
   *
   * @param {string} jobId
   * @param {'csv'|'xlsx'} [format] Defaults to CSV, matching the API default.
   */
  downloadUrl: (jobId, format = 'csv') => apiUrl(endpoints.results.export(), { jobId, format }),
};

export default resultsApi;
