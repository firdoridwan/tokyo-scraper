import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/** Supported directory websites and their input parameters. */
export const sourcesApi = {
  list: (options) => http.get(endpoints.sources.list(), options),
  getById: (id, options) => http.get(endpoints.sources.detail(id), options),
};

export default sourcesApi;
