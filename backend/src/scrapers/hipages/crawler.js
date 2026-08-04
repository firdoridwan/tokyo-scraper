/**
 * hipages — crawler (listing collector).
 *
 * Responsibility (and its limits)
 * -------------------------------
 * The crawler answers ONE question: *which pages exist, and how do we reach
 * them?* It discovers and yields URLs. It does not read business fields out of
 * a page and it does not decide what a record looks like — those belong to
 * `parser.js` and `extractor.js` respectively.
 *
 * Keeping URL discovery separate from parsing is what makes the pagination
 * strategy replaceable (link-based → infinite scroll) without touching a single
 * line of extraction code.
 *
 * Dependency injection
 * --------------------
 * No function below creates a browser. The runtime context (a Playwright page
 * or any object satisfying the same minimal interface) is passed IN. That keeps
 * these functions testable against a fake context, with no Chromium process
 * involved, and the two pure functions — `extractProfileUrls` and
 * `resolveNextPageUrl` — testable against saved HTML fixtures.
 *
 * Why pagination is link-driven and never URL-arithmetic
 * -----------------------------------------------------
 * This is the load-bearing decision in the file, and it was made from evidence,
 * not preference. Probing the live site on 2026-08-04 showed:
 *
 *   /find/electricians/nsw/sydney           → 200, 10 profiles
 *   /find/electricians/nsw/sydney?page=2    → 200, THE SAME 10 profiles
 *   /find/electricians/nsw/sydney?p=2       → 200, THE SAME 10 profiles
 *   /find/electricians/nsw/sydney/2         → 404
 *
 * An unknown query parameter is swallowed and the first page is served again,
 * with `<link rel="canonical">` still pointing at the un-parameterised URL.
 * A collector that incremented `?page=N` and stopped when a page yielded no new
 * URLs would therefore "work" — it would fetch page 1 twice, dedupe the second
 * copy to nothing, and report success. That is a fabricated result, and the
 * same shape of bug would silently cap every future run at one page.
 *
 * So the next page is only ever taken from a positive signal in the markup
 * (`rel="next"`, a web standard rather than a site-specific guess). No link,
 * no next page. Every termination is reported with a reason so "stopped after
 * one page" can never be confused with "collected everything".
 *
 * Scope note: this module collects profile URLs only. It does not open them.
 */
import { ApiError } from '../../utils/ApiError.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ sourceId: 'hipages', module: 'crawler' });

/** Absolute base every discovered path is resolved against. */
const SITE_ORIGIN = 'https://hipages.com.au';

/** Business profiles live under this path segment: `/connect/<profileKey>`. */
const PROFILE_PATH_PREFIX = '/connect/';

/**
 * Safety ceiling on pages walked in one run.
 *
 * A crawl loop with a network-supplied termination condition needs a bound that
 * does not depend on the network behaving. This is that bound, not a tuning
 * knob — callers set `maxPages` for normal limiting.
 */
const ABSOLUTE_PAGE_CEILING = 200;

/** Grace period for the network to fall quiet after `load` fires. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Why a collection run stopped. Reported so a short run is never mistaken for
 * a complete one.
 *
 * @typedef {'no-next-link'|'max-pages'|'page-ceiling'|'already-visited'|'aborted'} TerminationReason
 */

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — testable against saved fixtures, no browser involved
// ─────────────────────────────────────────────────────────────────────────────

/** @param {string} value */
function decodeHrefEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

/**
 * Builds the canonical search URL for a category and location.
 *
 * Pure and side-effect free by design — it is the one place the site's URL
 * shape is encoded, and it should be verifiable without a network call.
 *
 * No page number is encoded, deliberately. The site ignores `?page=` (see the
 * file header), so accepting one here would hand callers a parameter that
 * quietly does nothing — the exact failure this module is built to avoid.
 *
 * @param {{ category: string, location: string }} params
 * @returns {string} Absolute URL
 */
export function buildSearchUrl({ category, location } = {}) {
  const clean = (value, name) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw ApiError.badRequest(`hipages.crawler.buildSearchUrl() requires "${name}".`, {
        sourceId: 'hipages',
        module: 'crawler',
        fn: 'buildSearchUrl',
      });
    }
    return encodeURIComponent(value.trim().toLowerCase());
  };

  // The site's shape is /find/<category>/<state>/<suburb>; callers supply the
  // trailing "<state>/<suburb>" portion as `location`, so its slashes are kept.
  const locationPath = String(location ?? '')
    .trim()
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  if (locationPath === '') {
    throw ApiError.badRequest('hipages.crawler.buildSearchUrl() requires "location".', {
      sourceId: 'hipages',
      module: 'crawler',
      fn: 'buildSearchUrl',
    });
  }

  return `${SITE_ORIGIN}/find/${clean(category, 'category')}/${locationPath}`;
}

/**
 * Extracts every business profile URL from listing markup.
 *
 * Cards link to the same profile more than once (the card body and its
 * "recommendations" anchor), so fragments are dropped and the result is
 * de-duplicated. Order of first appearance is preserved — it mirrors the
 * site's own ranking, which is information the caller may want.
 *
 * @param {string} html      Raw listing-page markup
 * @param {string} [baseUrl] Page the markup came from, for relative hrefs
 * @returns {string[]} Absolute, de-duplicated profile URLs
 */
export function extractProfileUrls(html, baseUrl = SITE_ORIGIN) {
  if (typeof html !== 'string' || html === '') return [];

  const seen = new Set();
  const urls = [];

  for (const [, rawHref] of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try {
      url = new URL(decodeHrefEntities(rawHref), baseUrl);
    } catch {
      continue;
    }

    if (url.origin !== SITE_ORIGIN) continue;
    if (!url.pathname.startsWith(PROFILE_PATH_PREFIX)) continue;

    // A profile is exactly /connect/<key> — nothing deeper. Anything with more
    // segments is a sub-page, not a listing result.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) continue;

    // `#recommendations` and tracking queries point at the same profile.
    const canonical = `${SITE_ORIGIN}/${segments[0]}/${segments[1]}`;
    if (seen.has(canonical)) continue;

    seen.add(canonical);
    urls.push(canonical);
  }

  return urls;
}

/**
 * Resolves the URL of the next results page, if one exists.
 *
 * Returning `null` is the crawl's termination condition, so this reports a next
 * page ONLY on a positive signal — `rel="next"`, on either a `<link>` or an
 * `<a>`. It never synthesises `?page=N`: the site answers unknown query
 * parameters with page one and a 200, so a synthesised URL would look like a
 * real next page forever.
 *
 * The cost of this strictness is honest: if hipages ships pagination that does
 * not use `rel="next"`, this returns `null` and the run stops at one page. The
 * caller is told the reason (`no-next-link`) precisely so that case is visible
 * rather than silent.
 *
 * @param {string} html       Raw listing-page markup
 * @param {string} currentUrl The page the markup came from
 * @returns {string|null} Absolute next-page URL, or null on the last page
 */
export function resolveNextPageUrl(html, currentUrl = SITE_ORIGIN) {
  if (typeof html !== 'string' || html === '') return null;

  const tags = html.matchAll(/<(?:link|a)\b[^>]*\brel\s*=\s*["'][^"']*\bnext\b[^"']*["'][^>]*>/gi);

  for (const [tag] of tags) {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;

    try {
      const next = new URL(decodeHrefEntities(href), currentUrl);
      // A self-referential "next" is a malformed control, not a further page.
      if (next.href === new URL(currentUrl).href) continue;
      return next.href;
    } catch {
      continue;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation — the only functions that touch the injected page context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads one hipages page through the injected context and returns its markup.
 *
 * Listing and profile pages are fetched identically — same navigation, same
 * settle, same failure handling — so they share this one implementation. The
 * two exported wrappers exist because callers (and errors) benefit from saying
 * *which kind* of page failed, not because the behaviour differs.
 *
 * Returning markup rather than a live handle keeps the pure helpers and the
 * parser testable against saved fixtures.
 *
 * @param {object} context Playwright page (injected by the caller)
 * @param {string} url
 * @param {{ signal?: AbortSignal }} options
 * @param {string} fn        Caller name, for error context
 * @param {string} pageKind  Human label, for the error message
 * @returns {Promise<string>} Raw HTML
 */
async function fetchPage(context, url, options, fn, pageKind) {
  if (!context || typeof context.goto !== 'function') {
    throw ApiError.badRequest(`hipages.crawler.${fn}() requires a page context with goto().`, {
      sourceId: 'hipages',
      module: 'crawler',
      fn,
    });
  }
  options.signal?.throwIfAborted();

  const response = await context.goto(url, { waitUntil: 'load' });
  const status = response?.status?.() ?? null;

  if (status !== null && status >= 400) {
    throw ApiError.badRequest(`hipages ${pageKind} page returned HTTP ${status}.`, {
      sourceId: 'hipages',
      module: 'crawler',
      fn,
      url,
      status,
    });
  }

  // Best-effort settle so late-rendered content is present. Not reaching idle
  // is normal on pages holding analytics/chat connections open.
  try {
    await context.waitForLoadState?.('networkidle', { timeout: SETTLE_TIMEOUT_MS });
  } catch {
    log.debug('Network never fell idle — reading the page as it stands.', { url });
  }

  options.signal?.throwIfAborted();
  return context.content();
}

/**
 * Loads a single results page and returns its raw markup for the pure helpers.
 *
 * @param {object} context Playwright page (injected by the caller)
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>} Raw HTML
 */
export async function fetchListingPage(context, url, options = {}) {
  return fetchPage(context, url, options, 'fetchListingPage', 'listing');
}

/**
 * @typedef {object} ListingCollection
 * @property {string[]} profileUrls        De-duplicated absolute profile URLs
 * @property {string[]} pageUrls           Listing pages actually visited, in order
 * @property {number}   pagesVisited
 * @property {number}   duplicatesRemoved  Repeat sightings dropped across all pages
 * @property {TerminationReason} terminationReason Why the walk stopped
 */

/**
 * Walks the paginated result pages and collects the profile URLs found on them.
 *
 * The primary entry point of this module. Honours `maxPages`, the configured
 * inter-request delay, and an `AbortSignal`, and stops as soon as no next-page
 * link is present.
 *
 * Accepts either a ready-made `listingUrl` or `category` + `location`, so a
 * caller holding a category URL does not have to take it apart first.
 *
 * @param {object} context Playwright page (injected)
 * @param {{ listingUrl?: string, category?: string, location?: string, maxPages?: number }} params
 * @param {{ signal?: AbortSignal, delayMs?: number }} [options]
 * @returns {Promise<ListingCollection>}
 */
export async function collectListingUrls(context, params = {}, options = {}) {
  const startUrl = params.listingUrl
    ? new URL(params.listingUrl).href
    : buildSearchUrl({ category: params.category, location: params.location });

  const maxPages = Number.isInteger(params.maxPages)
    ? Math.min(Math.max(params.maxPages, 1), ABSOLUTE_PAGE_CEILING)
    : ABSOLUTE_PAGE_CEILING;
  const delayMs = options.delayMs ?? config.scraper.requestDelayMs;

  /** @type {Set<string>} */
  const profileUrls = new Set();
  /** @type {Set<string>} */
  const visited = new Set();
  const pageUrls = [];
  let duplicatesRemoved = 0;
  /** @type {TerminationReason} */
  let terminationReason = 'no-next-link';

  let nextUrl = startUrl;

  while (nextUrl) {
    if (options.signal?.aborted) {
      terminationReason = 'aborted';
      break;
    }
    if (visited.has(nextUrl)) {
      // The site serves page one for unknown params, so a repeated URL means a
      // pagination control is looping. Stopping here is what prevents that
      // becoming an endless crawl.
      terminationReason = 'already-visited';
      break;
    }
    if (pageUrls.length >= maxPages) {
      terminationReason = pageUrls.length >= ABSOLUTE_PAGE_CEILING ? 'page-ceiling' : 'max-pages';
      break;
    }

    // Politeness delay between requests — never before the first one.
    if (pageUrls.length > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    visited.add(nextUrl);
    const currentUrl = nextUrl;

    log.info('Fetching listing page', { url: currentUrl, page: pageUrls.length + 1 });
    const html = await fetchListingPage(context, currentUrl, options);
    pageUrls.push(currentUrl);

    const found = extractProfileUrls(html, currentUrl);
    for (const url of found) {
      if (profileUrls.has(url)) duplicatesRemoved += 1;
      else profileUrls.add(url);
    }
    log.info('Collected profile URLs', {
      url: currentUrl,
      found: found.length,
      totalUnique: profileUrls.size,
    });

    nextUrl = resolveNextPageUrl(html, currentUrl);
  }

  return {
    profileUrls: [...profileUrls],
    pageUrls,
    pagesVisited: pageUrls.length,
    duplicatesRemoved,
    terminationReason,
  };
}

/**
 * Loads a single business profile page and returns its raw markup.
 *
 * No phone-reveal interaction is needed: the number is already present in the
 * page's hydration payload, which `parser.parseProfilePage()` reads. Clicking
 * the reveal button would fire the site's click-tracking endpoint for no gain.
 *
 * @param {object} context Playwright page (injected by the caller)
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string>} Raw HTML
 */
export async function fetchProfilePage(context, url, options = {}) {
  return fetchPage(context, url, options, 'fetchProfilePage', 'profile');
}

export const crawler = {
  buildSearchUrl,
  extractProfileUrls,
  resolveNextPageUrl,
  fetchListingPage,
  collectListingUrls,
  fetchProfilePage,
};

export default crawler;
