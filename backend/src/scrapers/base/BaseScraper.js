/**
 * Abstract contract every site adapter must satisfy.
 *
 * NOTE: intentionally contains zero Playwright code. This file defines *what*
 * a scraper is; a concrete adapter decides *how*. When the engine is built, a
 * Playwright browser/context is injected through the constructor rather than
 * created here — that keeps adapters unit-testable without launching a browser.
 *
 * Lifecycle the runner will follow:
 *
 *   setup()  ->  for each page: collectListings() -> extractDetail()  ->  teardown()
 */
import { ApiError } from '../../utils/ApiError.js';

export class BaseScraper {
  /**
   * @param {object} deps
   * @param {import('../../scrapers/types.js').SourceDescriptor} deps.source
   * @param {object} deps.params   Validated job parameters (query, location, maxPages…)
   * @param {object} deps.options  Runtime options (headless, delays, timeouts)
   * @param {object} deps.logger   Scoped logger
   * @param {AbortSignal} [deps.signal] Cancellation signal for the job
   */
  constructor({ source, params, options, logger, signal }) {
    if (new.target === BaseScraper) {
      throw new TypeError('BaseScraper is abstract and cannot be instantiated directly');
    }
    this.source = source;
    this.params = params;
    this.options = options;
    this.logger = logger;
    this.signal = signal;
  }

  /** Unique key of the source this adapter serves. */
  static get sourceId() {
    throw new Error('Scraper subclasses must define a static `sourceId`');
  }

  /** Acquire resources (browser context, cookies, session). */
  async setup() {}

  /**
   * Build the list of URLs to visit for the given job parameters.
   * @returns {Promise<string[]>}
   */
  async buildTargetUrls() {
    throw ApiError.notImplemented(`${this.source.id}: buildTargetUrls() not implemented`);
  }

  /**
   * Extract listing stubs from one search-results page.
   * @param {string} _url
   * @returns {Promise<object[]>}
   */
  async collectListings(_url) {
    throw ApiError.notImplemented(`${this.source.id}: collectListings() not implemented`);
  }

  /**
   * Enrich a single listing with detail-page fields.
   * @param {object} listing
   * @returns {Promise<object>}
   */
  async extractDetail(listing) {
    return listing;
  }

  /** Release resources. Always called, including on failure. */
  async teardown() {}
}

export default BaseScraper;
