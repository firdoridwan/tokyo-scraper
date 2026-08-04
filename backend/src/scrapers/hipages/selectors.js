/**
 * hipages — selector map.
 *
 * ⚠️  EVERY SELECTOR IS INTENTIONALLY `null`.
 *
 * This file is the module's single point of contact with hipages' DOM. It is
 * deliberately empty because a *guessed* selector is worse than a missing one:
 * a guess looks authoritative, passes review, and then silently extracts wrong
 * data or nothing at all. A `null` fails loudly on first use.
 *
 * Why selectors live alone, apart from logic
 * ------------------------------------------
 * Markup is the fastest-changing dependency a scraper has. Isolating selectors
 * means a site redesign is a one-file edit, diffable in review, with no risk of
 * disturbing crawl or parse logic.
 *
 * How to fill this in (the next task, not this one)
 * -------------------------------------------------
 * 1. Open a real results page and a real profile page in a browser.
 * 2. For each key below, follow its TODO and inspect the live DOM.
 * 3. Prefer stable hooks in this order:
 *      `data-*` attributes  >  semantic elements/ARIA  >  structural classes
 *    Never depend on generated/hashed class names (e.g. `.css-1x2y3z`) — they
 *    change on every deploy.
 * 4. Record the date verified in `VERIFIED_AT` and flip `implemented: true` in
 *    `descriptor.js` only once the module is complete.
 *
 * Legal note: confirm the site's Terms of Service and robots.txt before
 * inspecting or collecting at volume.
 */

/**
 * ISO date the selectors below were last confirmed against the live site.
 * `null` means: never verified. Update this whenever a selector changes.
 * @type {string|null}
 */
export const VERIFIED_AT = null;

/**
 * Selectors for the search-results (listing) page.
 * @type {Record<string, string|null>}
 */
export const listingSelectors = {
  /**
   * TODO: Inspect the repeating result card on a category+location results
   * page. Identify the outermost element that wraps exactly ONE business and
   * whose count equals the number of visible results. Confirm it does not also
   * match sponsored/ad slots — if it does, note how to distinguish them.
   */
  card: null,

  /**
   * TODO: Within a single card, locate the element containing the business's
   * trading name. Confirm whether it is a heading or a link, and whether the
   * text needs trimming of badges (e.g. "Verified").
   */
  businessName: null,

  /**
   * TODO: Locate the anchor linking to the business's profile page. Record
   * whether `href` is absolute or root-relative — `crawler.js` will need to
   * know in order to resolve it.
   */
  profileLink: null,

  /**
   * TODO: Locate the numeric star rating. Confirm whether the value is text
   * content or an attribute (e.g. `aria-label="4.8 out of 5"`), because the two
   * require different parsing in `parser.js`.
   */
  rating: null,

  /**
   * TODO: Locate the review count. Confirm the surrounding text format
   * ("(128)" vs "128 reviews") so the parser can strip it reliably.
   */
  reviewCount: null,

  /**
   * TODO: Locate the suburb/state line on the card. Confirm whether suburb and
   * state share one node (needing a split) or are separate nodes.
   */
  location: null,
};

/**
 * Selectors for an individual business profile page.
 * Only needed when a job runs with `includeDetails: 'full'`.
 * @type {Record<string, string|null>}
 */
export const detailSelectors = {
  /**
   * TODO: Determine whether the phone number is present in the initial HTML or
   * revealed only after interaction. If it requires a click, record the trigger
   * element here and note it — that decision changes the crawler's cost model.
   */
  phoneRevealTrigger: null,

  /**
   * TODO: Locate the phone number element in its final (revealed) state.
   * Confirm whether it is text or a `tel:` href.
   */
  phone: null,

  /**
   * TODO: Locate the outbound website link. Confirm whether it is a direct URL
   * or a tracking redirect that must be unwrapped.
   */
  website: null,

  /**
   * TODO: Locate the ABN (Australian Business Number). Confirm whether it is
   * always present — if it is optional, the extractor must tolerate absence.
   */
  abn: null,

  /**
   * TODO: Locate the service/category tags. This is expected to match MULTIPLE
   * elements; confirm whether they should be collected as a list.
   */
  serviceTags: null,
};

/**
 * Selectors used to walk from one results page to the next.
 * @type {Record<string, string|null>}
 */
export const paginationSelectors = {
  /**
   * TODO: Locate the "next page" control. Confirm whether pagination is
   * link-based (`rel="next"`), button-based, or infinite-scroll — each implies
   * a different crawl strategy in `crawler.js`.
   */
  nextPage: null,

  /**
   * TODO: Determine how to detect the LAST page (e.g. next link absent, or
   * present but disabled). Without this the crawler cannot terminate cleanly.
   */
  lastPageIndicator: null,
};

/**
 * Selectors that detect anti-bot interstitials.
 *
 * These are not optional. Without them a blocked response parses as an empty
 * page and the job reports "0 results" instead of "blocked" — the single most
 * misleading failure mode a scraper can have.
 *
 * @type {Record<string, string|null>}
 */
export const guardSelectors = {
  /**
   * TODO: Trigger or locate a CAPTCHA interstitial and record its container.
   */
  captcha: null,

  /**
   * TODO: Record the access-denied / rate-limited page marker.
   */
  blocked: null,

  /**
   * TODO: Record the legitimate "no results for this search" empty state. This
   * MUST be distinguishable from a block — confusing the two causes silent
   * data loss.
   */
  emptyResults: null,
};

/** Aggregate export — the shape `parser.js` and `extractor.js` will consume. */
export const selectors = {
  VERIFIED_AT,
  listing: listingSelectors,
  detail: detailSelectors,
  pagination: paginationSelectors,
  guards: guardSelectors,
};

export default selectors;
