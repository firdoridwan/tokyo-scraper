/**
 * Source service — read-only view over the scraper registry.
 *
 * Shapes registry descriptors into the public API representation. The
 * `loadScraper` function is stripped here so internals never leak over HTTP.
 */
import { listSources, requireSource } from '../scrapers/registry.js';

/** @param {import('../scrapers/types.js').SourceDescriptor} source */
function toPublicSource(source) {
  return {
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    country: source.country,
    description: source.description,
    status: source.status,
    implemented: source.implemented,
    fields: source.fields,
    outputFields: source.outputFields,
  };
}

export const sourceService = {
  list() {
    return listSources().map(toPublicSource);
  },

  /** @param {string} id */
  getById(id) {
    return toPublicSource(requireSource(id));
  },
};

export default sourceService;
