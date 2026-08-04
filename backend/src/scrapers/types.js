/**
 * Shared type definitions for the scraper layer.
 *
 * Plain JSDoc typedefs — they give editor completion and act as the written
 * contract between a source module, the registry, and the frontend form that
 * renders a source's parameters.
 */

/**
 * A parameter a source accepts. The frontend renders its form dynamically from
 * this list, so adding a new site never requires touching the UI.
 *
 * @typedef {object} SourceField
 * @property {string} name              Key sent back in the job payload
 * @property {string} label             Human-readable label
 * @property {'text'|'number'|'select'} type
 * @property {boolean} required
 * @property {string} [placeholder]
 * @property {string} [helpText]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number|string} [defaultValue]
 * @property {{ value: string, label: string }[]} [options]  For `select` fields
 */

/**
 * Everything the app needs to know about a supported website *without*
 * loading its scraping implementation.
 *
 * @typedef {object} SourceDescriptor
 * @property {string} id              Stable key, e.g. "hipages"
 * @property {string} name            Display name
 * @property {string} baseUrl
 * @property {string} country         ISO country code
 * @property {string} description
 * @property {'available'|'planned'|'maintenance'} status
 * @property {boolean} implemented    False while only the descriptor exists
 * @property {SourceField[]} fields   Parameters the source accepts
 * @property {string[]} outputFields  Columns this source can produce
 * @property {() => Promise<typeof import('./base/BaseScraper.js').BaseScraper>} [loadScraper]
 *           Lazy loader for the adapter class — keeps Playwright out of the
 *           process until a job actually needs it.
 */

export {};
