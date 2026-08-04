import { http } from '../client.js';
import { endpoints } from '../endpoints.js';

/** System-level reads: health probe and dashboard counters. */
export const systemApi = {
  health: (options) => http.get(endpoints.health(), options),
  stats: (options) => http.get(endpoints.stats(), options),
};

export default systemApi;
