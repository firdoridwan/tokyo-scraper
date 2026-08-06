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
 * Discovery runs against the site's own directory API
 * ---------------------------------------------------
 * The page's "View More" control is not infinite scroll and not a DOM trick: it
 * issues one request to
 *
 *   GET https://gateway.hipages.com.au/directory/v1/businesses
 *       ?filter[category]=…&filter[state]=…&filter[suburb]=…
 *       &page[limit]=10&page[offset]=N
 *
 * and appends the returned businesses. That endpoint is what this collector
 * calls. It needs no browser, no cookie and no key, answers in ~500 ms with
 * JSON:API, and carries `profilePagePath` for every business — which is the
 * only field discovery needs.
 *
 * Why offset arithmetic is safe HERE, when it was not on the HTML page
 * -------------------------------------------------------------------
 * The rule this file has always enforced is that a page number must never be
 * synthesised, because the results page swallows unknown parameters. Probing on
 * 2026-08-04 showed exactly that:
 *
 *   /find/electricians/nsw/sydney           → 200, 10 profiles
 *   /find/electricians/nsw/sydney?page=2    → 200, THE SAME 10 profiles
 *   /find/electricians/nsw/sydney/2         → 404
 *
 * A collector incrementing `?page=N` there would refetch page one forever and
 * report success — a fabricated result. The API does not have that failure
 * mode, and probing on 2026-08-05 proved it rather than assuming it:
 *
 *   page[offset]=90  → 200, 10 businesses
 *   page[offset]=95  → 400 "data.offset should be <= 90"
 *   page[limit]=11   → 400 "data.limit should be <= 10"
 *   past the end     → 200 with an EMPTY data array
 *
 * The endpoint states its own bounds and refuses an out-of-range offset instead
 * of silently re-serving the first page. So the walk is bounded three ways —
 * the caller's page budget, an empty response, and the API's own offset
 * ceiling — and every termination still reports which one fired, so "stopped
 * early" can never be confused with "collected everything".
 *
 * Dependency injection
 * --------------------
 * No function below creates a browser. The runtime context (a Playwright page
 * or any object satisfying the same minimal interface) is still passed in and
 * still used by `fetchProfilePage()`, which the company processor drives.
 * `collectListingUrls()` no longer needs it — discovery is a plain HTTP call —
 * but it keeps accepting it so every caller works unchanged.
 *
 * The HTML helpers below (`extractProfileUrls`, `resolveNextPageUrl`,
 * `fetchListingPage`, `buildSearchUrl`) are retained: they are pure, they are
 * the fallback if the API is withdrawn, and `buildSearchUrl` still turns a
 * category + location into the URL this module parses.
 *
 * Scope note: this module collects profile URLs only. It does not open them.
 */
import { ApiError } from '../../utils/ApiError.js';
// `ApiError.badRequest()` cannot carry a `cause`; the constructor can, and a
// network failure is exactly the case where the original error must survive.
import { ERROR_CODE } from '../../config/constants.js';
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

/** The directory API behind the site's "View More" control. */
const DIRECTORY_API_URL = 'https://gateway.hipages.com.au/directory/v1/businesses';

/**
 * Records per request. Not a preference — `page[limit]=11` is rejected with
 * `400 "data.limit should be <= 10"`, so 10 is the API's own maximum.
 */
const API_PAGE_SIZE = 10;

/**
 * Highest offset the API accepts; `page[offset]=95` answers
 * `400 "data.offset should be <= 90"`. With ten records a page that puts the
 * reachable depth at roughly 100 businesses per category + suburb.
 */
const API_MAX_OFFSET = 90;

/** Ceiling on how long one API request may take before it is abandoned. */
const API_TIMEOUT_MS = 15_000;

/**
 * Why a collection run stopped. Reported so a short run is never mistaken for
 * a complete one.
 *
 * @typedef {'no-more-results'|'max-pages'|'page-ceiling'|'aborted'} TerminationReason
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
// Directory API — the discovery path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns a category page URL into the three filters the API expects.
 *
 * The site's URL shape is `/find/<category>/<state>/<suburb>` and the API's
 * filters are those same three values, so this is a direct read rather than a
 * lookup — no mapping table to drift out of date.
 *
 * Pure, and strict about what it accepts. A URL of another shape throws here,
 * at the start of the run with the URL in the message, instead of becoming a
 * silently empty result set later.
 *
 * @param {string} rawUrl A hipages category page URL
 * @returns {{ category: string, state: string, suburb: string }}
 */
export function parseCategoryUrl(rawUrl) {
  const fail = (detail) =>
    ApiError.badRequest(`Not a hipages category URL: ${detail}`, {
      sourceId: 'hipages',
      module: 'crawler',
      fn: 'parseCategoryUrl',
      url: String(rawUrl),
      expected: `${SITE_ORIGIN}/find/<category>/<state>/<suburb>`,
    });

  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw fail(`"${rawUrl}" is not a valid URL.`);
  }

  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] !== 'find') throw fail(`path "${url.pathname}" does not start with /find/.`);
  if (segments.length !== 4) {
    throw fail(
      `path "${url.pathname}" has ${segments.length - 1} segment(s) after /find/, expected 3 ` +
        '(category, state, suburb).',
    );
  }

  const [, category, state, suburb] = segments.map((segment) =>
    decodeURIComponent(segment).trim().toLowerCase(),
  );

  return { category, state, suburb };
}

/**
 * Builds one directory API request URL.
 *
 * Exported because it is worth asserting against without a network call — the
 * bracketed JSON:API parameter names (`filter[state]`, `page[offset]`) are easy
 * to get subtly wrong and `URLSearchParams` encodes the brackets for us.
 *
 * @param {{ category: string, state: string, suburb: string }} filters
 * @param {number} offset
 * @returns {string}
 */
export function buildDirectoryRequestUrl(filters, offset) {
  const query = new URLSearchParams({
    'filter[state]': filters.state,
    'filter[category]': filters.category,
    'filter[suburb]': filters.suburb,
    'page[limit]': String(API_PAGE_SIZE),
    'page[offset]': String(offset),
  });

  return `${DIRECTORY_API_URL}?${query}`;
}

/**
 * Turns a rejected `fetch()` into something a log can be read from.
 *
 * `fetch` reports every transport-layer fault the same way: a `TypeError` whose
 * message is the constant string `"fetch failed"`. DNS failure, refused
 * connection, reset socket, unreachable network and TLS failure are
 * indistinguishable at that level — the diagnosis is one layer down, on
 * `error.cause`, as `code` / `errno` / `syscall` / `hostname` / `address`.
 *
 * Reporting only `error.message` therefore destroys the entire diagnosis at the
 * throw site: six different faults produce one identical, unactionable line and
 * the operator cannot tell a DNS outage from a dropped socket. This function
 * exists to stop that happening.
 *
 * Rejections that carry no `cause` — the request timeout, an abort — are
 * described from the error itself, which for those cases is already meaningful.
 *
 * Pure: it reads an error and returns a plain object. It changes no behaviour,
 * retries nothing, and decides nothing.
 *
 * @param {unknown} error The value `fetch()` rejected with
 * @returns {{ summary: string, detail: Record<string, unknown> }}
 *   `summary` is one line safe to put in a message; `detail` is the structured
 *   context for the log and the error's details.
 */
export function describeFetchFailure(error) {
  const cause = error?.cause ?? null;
  // The system-level fields live on the cause when there is one, and on the
  // error itself for aborts and other direct rejections.
  const source = cause ?? error;

  // System error codes are strings (`ENOTFOUND`, `UND_ERR_SOCKET`). A
  // DOMException also has a `code`, but it is a legacy NUMBER (AbortError is
  // 20) that identifies nothing useful — reported as-is it reads "failed: 20".
  const systemCode = typeof source?.code === 'string' ? source.code : undefined;

  const detail = {
    errorName: error?.name,
    errorMessage: error?.message,
    causeName: cause?.name,
    causeMessage: cause?.message,
    code: systemCode,
    errno: source?.errno,
    syscall: source?.syscall,
    hostname: source?.hostname,
    address: source?.address,
    port: source?.port,
  };

  // Absent fields are dropped rather than logged as nulls — a line of eight
  // `null`s hides the two values that matter.
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined || value === null) delete detail[key];
  }

  // Preference order: the system code (ENOTFOUND, ECONNRESET…) names the fault
  // outright; failing that a SPECIFIC error name does (AbortError). The generic
  // names are skipped — "Error" and "TypeError" label nothing, and `TypeError:
  // fetch failed` is the very wrapper this function exists to see past.
  const GENERIC_NAMES = ['Error', 'TypeError'];
  const specificName =
    typeof error?.name === 'string' && !GENERIC_NAMES.includes(error.name) ? error.name : undefined;

  const label = systemCode ?? specificName ?? error?.message ?? 'unknown error';

  const explanation = detail.causeMessage ?? detail.errorMessage ?? null;
  const summary =
    explanation && explanation !== label ? `${label} — ${explanation}` : String(label);

  return { summary, detail };
}

/**
 * Reads one page of businesses from the directory API.
 *
 * The caller's `AbortSignal` and the request timeout both have to cancel the
 * same request, so they are merged into one controller.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<object[]>} The `data` array, or `[]` when the page is empty
 */
async function fetchDirectoryPage(url, options = {}) {
  options.signal?.throwIfAborted();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), API_TIMEOUT_MS);

  // Named so it can be removed again. `{ once: true }` only retires a listener
  // that actually fires, and the overwhelmingly common case is that it does not
  // — leaving one listener per directory page attached to the run's signal for
  // as long as the run lives. Ten pages, ten listeners, every run.
  const forwardAbort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/vnd.api+json',
        'user-agent': config.scraper.userAgent,
      },
      signal: controller.signal,
    });
  } catch (error) {
    // A caller cancelling is not a network fault; it stays a cancellation.
    options.signal?.throwIfAborted();

    const { summary, detail } = describeFetchFailure(error);
    // Our own guard firing looks like any other abort from the outside, so the
    // one thing only this scope knows is recorded explicitly.
    const timedOut = controller.signal.aborted;

    const context = {
      sourceId: 'hipages',
      module: 'crawler',
      fn: 'fetchDirectoryPage',
      url,
      ...detail,
      ...(timedOut ? { timedOut, timeoutMs: API_TIMEOUT_MS } : {}),
    };

    // Logged here because this is the only place the cause chain still exists:
    // the error handler logs a message and a status, not an error's internals.
    log.error('Directory API request failed', context);

    throw new ApiError(400, `hipages directory API request failed: ${summary}`, {
      code: ERROR_CODE.BAD_REQUEST,
      details: context,
      // The original error, chained — a stack-walking consumer keeps everything.
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }

  const body = await response.text();

  if (!response.ok) {
    // The API explains itself in `errors[].meta.message` ("data.offset should be
    // <= 90"); surfacing that beats a bare status code.
    let detail = null;
    try {
      detail = JSON.parse(body)?.errors?.[0]?.meta?.message ?? null;
    } catch {
      detail = null;
    }
    throw ApiError.badRequest(
      `hipages directory API returned HTTP ${response.status}${detail ? ` — ${detail}` : ''}.`,
      { sourceId: 'hipages', module: 'crawler', fn: 'fetchDirectoryPage', url, status: response.status },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw ApiError.badRequest('hipages directory API returned a body that is not JSON.', {
      sourceId: 'hipages',
      module: 'crawler',
      fn: 'fetchDirectoryPage',
      url,
    });
  }

  return Array.isArray(parsed?.data) ? parsed.data : [];
}

/**
 * Reads the profile URL out of one API record.
 *
 * `profilePagePath` is preferred because it is the site's own path for that
 * business; `key` is the documented fallback and produces the identical URL.
 * A record carrying neither is skipped rather than turned into a guess.
 *
 * @param {object} record JSON:API resource object
 * @returns {string|null} Absolute profile URL
 */
function toProfileUrl(record) {
  const attributes = record?.attributes ?? {};
  const path =
    typeof attributes.profilePagePath === 'string' && attributes.profilePagePath.trim() !== ''
      ? attributes.profilePagePath.trim()
      : typeof attributes.key === 'string' && attributes.key.trim() !== ''
        ? `${PROFILE_PATH_PREFIX}${attributes.key.trim()}`
        : null;

  if (path === null) return null;

  try {
    return new URL(path, SITE_ORIGIN).href;
  } catch {
    return null;
  }
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
 * @property {string[]} pageUrls           Pages actually requested, in order
 * @property {number}   pagesVisited
 * @property {number}   duplicatesRemoved  Repeat sightings dropped across all pages
 * @property {TerminationReason} terminationReason Why the walk stopped
 */

/**
 * Walks the directory API and collects business profile URLs.
 *
 * The primary entry point of this module, and unchanged in signature, inputs
 * and output shape — only the source of the URLs moved from the results page's
 * markup to the API behind its "View More" control. Every caller works as
 * before.
 *
 * `maxPages` keeps its old meaning. A results page showed ten businesses and an
 * API page returns ten, so "walk up to N pages" is still "collect up to N × 10
 * companies", and the result is truncated to that number. The one visible
 * difference is that `maxPages: 5` now actually yields 50 URLs, where the HTML
 * path stopped at 10 because the page carries no `rel="next"` link.
 *
 * Three things end the walk, and each reports itself:
 *   `max-pages`       the caller's budget was met
 *   `no-more-results` the API returned an empty page
 *   `page-ceiling`    the next offset would exceed the API's documented maximum
 *
 * @param {object} context Playwright page. Accepted for interface compatibility
 *   and no longer used here — the API needs no browser — so callers, and the
 *   company processor that shares this context, are unaffected.
 * @param {{ listingUrl?: string, category?: string, location?: string, maxPages?: number }} params
 * @param {{ signal?: AbortSignal, delayMs?: number }} [options]
 * @returns {Promise<ListingCollection>}
 */
export async function collectListingUrls(context, params = {}, options = {}) {
  const startUrl = params.listingUrl
    ? new URL(params.listingUrl).href
    : buildSearchUrl({ category: params.category, location: params.location });

  const filters = parseCategoryUrl(startUrl);

  const maxPages = Number.isInteger(params.maxPages)
    ? Math.min(Math.max(params.maxPages, 1), ABSOLUTE_PAGE_CEILING)
    : ABSOLUTE_PAGE_CEILING;
  const wanted = maxPages * API_PAGE_SIZE;
  const delayMs = options.delayMs ?? config.scraper.requestDelayMs;

  /** @type {Map<string, string>} key → profile URL. The key is the API's own
   * business identifier, which is what the site de-duplicates on; the first
   * page overlaps later ones by a record or two. */
  const byKey = new Map();
  const pageUrls = [];
  let duplicatesRemoved = 0;
  /** @type {TerminationReason} */
  let terminationReason = 'max-pages';

  for (let offset = 0; ; offset += API_PAGE_SIZE) {
    if (options.signal?.aborted) {
      terminationReason = 'aborted';
      break;
    }
    if (byKey.size >= wanted) {
      terminationReason = 'max-pages';
      break;
    }
    if (offset > API_MAX_OFFSET) {
      // Asking anyway would earn a 400. Stopping here reports the ceiling as a
      // ceiling instead of as a failed request.
      terminationReason = 'page-ceiling';
      break;
    }

    // Politeness delay between requests — never before the first one.
    if (pageUrls.length > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const requestUrl = buildDirectoryRequestUrl(filters, offset);
    log.info('Requesting directory page', { offset, page: pageUrls.length + 1 });

    const records = await fetchDirectoryPage(requestUrl, options);
    pageUrls.push(requestUrl);

    if (records.length === 0) {
      terminationReason = 'no-more-results';
      log.info('Directory API returned an empty page', { offset });
      break;
    }

    for (const record of records) {
      const key = record?.attributes?.key;
      const profileUrl = toProfileUrl(record);
      if (typeof key !== 'string' || key === '' || profileUrl === null) continue;

      if (byKey.has(key)) duplicatesRemoved += 1;
      else byKey.set(key, profileUrl);
    }

    log.info('Collected profile URLs', {
      offset,
      returned: records.length,
      totalUnique: byKey.size,
    });
  }

  return {
    // Truncated to the requested count: `maxPages` is a budget, and the first
    // page returns more than `page[limit]` asks for.
    profileUrls: [...byKey.values()].slice(0, wanted),
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
  parseCategoryUrl,
  buildDirectoryRequestUrl,
  describeFetchFailure,
  collectListingUrls,
  fetchProfilePage,
  // Retained HTML helpers — no longer on the discovery path, see the header.
  extractProfileUrls,
  resolveNextPageUrl,
  fetchListingPage,
};

export default crawler;
