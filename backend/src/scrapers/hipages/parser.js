/**
 * hipages — parser.
 *
 * Responsibility (and its limits)
 * -------------------------------
 * The parser turns RAW MARKUP into a loose, source-shaped intermediate object.
 * It does not fetch, does not navigate, and does not decide the final record
 * schema — normalising into the shape declared by `descriptor.supportedOutputs`
 * is `extractor.js`'s job.
 *
 * Why the split matters: parsing is where site markup leaks in. Confining that
 * leak to this file means the extractor's output contract stays stable even
 * when hipages redesigns.
 *
 * Where the profile data actually comes from
 * ------------------------------------------
 * `parseProfilePage()` deliberately does NOT read CSS selectors, and that is
 * why `selectors.js` is still untouched. A hipages profile page ships its own
 * data twice, in machine-readable form, before any element is styled:
 *
 *   1. `window.__reactRouterContext.streamController.enqueue("…")` — the React
 *      Router (turbo-stream) hydration payload. This is the page's own loader
 *      data: the exact object the site renders itself from. It is the richest
 *      source and the ONLY one carrying the phone number, which the visible DOM
 *      hides behind a "Reveal phone number" button.
 *   2. `<script type="application/ld+json">` — a schema.org `@graph` containing
 *      the business node (name, aggregateRating, reviews, service catalogue).
 *
 * Reading these instead of the rendered markup is not a shortcut, it is the
 * stable choice: the visible classes are generated utility strings
 * (`text-title-lg`, `after:bg-content`) that change on every deploy, while both
 * payloads above are contracts the site maintains for its own runtime and for
 * search engines. Source 1 is primary; source 2 is the fallback, so a change to
 * either one degrades a field rather than emptying the record.
 *
 * Deliberately NOT collected
 * --------------------------
 * The hydration payload also carries an email address and outbound tracking
 * URLs. Neither is read here, by rule.
 *
 * Field set: the nine fields specified for the profile parser, plus `website`,
 * added when the company processor needed to answer "does this company have a
 * site?" — the processor must not re-read the markup itself to find out.
 *
 * Purity
 * ------
 * Every function takes markup and returns data. No I/O, no browser, no clock.
 * That makes the whole layer testable against saved HTML fixtures — the cheapest
 * regression net a scraper can have.
 *
 * On errors: `ApiError.notImplemented` is the project's not-implemented signal
 * (code `NOT_IMPLEMENTED`, surfaces as HTTP 501 via the existing middleware).
 */
import { ApiError } from '../../utils/ApiError.js';

/** @param {string} fn @param {string} [detail] */
const notImplemented = (fn, detail) =>
  ApiError.notImplemented(`hipages.parser.${fn}() is not implemented yet.`, {
    sourceId: 'hipages',
    module: 'parser',
    fn,
    ...(detail ? { detail } : {}),
  });

// ─────────────────────────────────────────────────────────────────────────────
// Source markers
// ─────────────────────────────────────────────────────────────────────────────

/** Call site that carries the hydration payload as a single JS string literal. */
const HYDRATION_MARKER = 'window.__reactRouterContext.streamController.enqueue(';

/** Route whose loader data holds the profile. Keyed by React Router route id. */
const PROFILE_ROUTE_ID = 'routes/_connect.connect.$profile';

/**
 * Gallery URLs arrive as templates containing this literal token — the site's
 * image proxy substitutes a size at render time. It is left in place rather
 * than resolved to an invented dimension.
 */
export const GALLERY_SIZE_PLACEHOLDER = ':SIZE';

// ─────────────────────────────────────────────────────────────────────────────
// Small text helpers
// ─────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** @param {string} text */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Trims a value and collapses "present but empty" to `null`.
 *
 * hipages uses `""` for unset optional fields (website, service_area, fax). An
 * empty string reads as data downstream; `null` reads as absence, which is what
 * it actually means.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** @param {unknown} value @returns {number|null} */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Flattens the profile's rich-text fields (TinyMCE output: paragraphs, tables,
 * inline styles) into readable plain text.
 *
 * Block boundaries become newlines *before* tags are stripped, otherwise table
 * cells and paragraphs run together into one unreadable line.
 *
 * @param {unknown} html
 * @returns {string|null}
 */
function htmlToText(html) {
  if (typeof html !== 'string' || html.trim() === '') return null;

  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|tbody|blockquote)\s*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return (
    decodeEntities(text)
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 1 — the React Router (turbo-stream) hydration payload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the JS string literal passed to `enqueue(…)`.
 *
 * The payload is JSON that has been string-escaped and embedded in a script, so
 * it cannot be matched with a lazy regex: the encoded JSON is full of `\"`
 * sequences and any `")` inside it would terminate the match early. Scanning
 * character by character while honouring backslash escapes is the only correct
 * way to find the literal's real end.
 *
 * @param {string} html
 * @returns {string|null} The literal's decoded contents, or `null` if absent.
 */
function readHydrationLiteral(html) {
  const markerAt = html.indexOf(HYDRATION_MARKER);
  if (markerAt === -1) return null;

  const openQuoteAt = markerAt + HYDRATION_MARKER.length;
  if (html[openQuoteAt] !== '"') return null;

  let escaped = '';
  for (let i = openQuoteAt + 1; i < html.length; i += 1) {
    const char = html[i];
    if (char === '\\') {
      escaped += char + html[i + 1];
      i += 1;
      continue;
    }
    if (char === '"') {
      // JSON string syntax is a strict subset of the JS literal used here, so
      // re-quoting and parsing performs the unescaping (including \uXXXX).
      try {
        return JSON.parse(`"${escaped}"`);
      } catch {
        return null;
      }
    }
    escaped += char;
  }
  return null;
}

/**
 * Sentinel indices used by turbo-stream in place of values that cannot be
 * represented as array positions.
 */
const TURBO_SENTINELS = new Map([
  [-1, undefined],
  [-2, NaN],
  [-3, -Infinity],
  [-4, -0],
  [-5, null],
  [-6, Infinity],
  [-7, undefined],
]);

/**
 * Rebuilds a value graph from turbo-stream's flattened array encoding.
 *
 * The payload is one flat array in which *every* value — including object keys
 * — is stored once and referenced by index. An object is encoded as
 * `{"_<keyIndex>": <valueIndex>}`. Flattening this way lets the site dedupe
 * repeated strings and encode cycles; rebuilding it needs a cache keyed by
 * index, which also makes cycles terminate.
 *
 * @param {unknown[]} flat
 * @returns {unknown}
 */
function hydrateTurboStream(flat) {
  const cache = new Map();

  /** @param {number} index */
  const resolve = (index) => {
    if (typeof index !== 'number') return index;
    if (index < 0) return TURBO_SENTINELS.get(index);
    if (cache.has(index)) return cache.get(index);

    const raw = flat[index];

    if (raw === null || typeof raw !== 'object') {
      cache.set(index, raw);
      return raw;
    }

    if (Array.isArray(raw)) {
      const list = [];
      cache.set(index, list);
      for (const item of raw) list.push(resolve(item));
      return list;
    }

    const object = {};
    cache.set(index, object);
    for (const [encodedKey, valueIndex] of Object.entries(raw)) {
      // Keys are `_<index>`; anything else is taken literally rather than
      // silently dropped, so an encoding change shows up as a stray key.
      const key = /^_\d+$/.test(encodedKey)
        ? String(resolve(Number(encodedKey.slice(1))))
        : encodedKey;
      object[key] = resolve(valueIndex);
    }
    return object;
  };

  return resolve(0);
}

/**
 * Reads the profile route's loader data out of the page.
 *
 * @param {string} html
 * @returns {object|null} `null` when the payload is missing or unreadable —
 *   callers fall back to JSON-LD rather than failing.
 */
export function readHydrationData(html) {
  const literal = readHydrationLiteral(html);
  if (literal === null) return null;

  let flat;
  try {
    flat = JSON.parse(literal);
  } catch {
    return null;
  }
  if (!Array.isArray(flat)) return null;

  const root = hydrateTurboStream(flat);
  const profile = root?.loaderData?.[PROFILE_ROUTE_ID];
  return profile && typeof profile === 'object' ? profile : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source 2 — schema.org JSON-LD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hipages tags the listed business's node with this `@id` suffix. It is the
 * site's own convention and the only unambiguous marker in the graph.
 */
const TRADIE_NODE_ID_SUFFIX = '#tradie';

/** Business profiles live under this path; category/SEO pages never do. */
const PROFILE_URL_MARKER = '/connect/';

/**
 * Nodes that describe the page or the site rather than a listed business.
 *
 * `WebPage` matters most here: on a profile page its `url` is the profile URL,
 * so it satisfies the profile-URL test while carrying none of the business's
 * data. Matching it silently emptied the rating fields.
 */
const STRUCTURAL_LD_TYPES = new Set([
  'WebPage',
  'WebSite',
  'Organization',
  'BreadcrumbList',
  'ImageObject',
  'Service',
  'Product',
  'FAQPage',
  'ItemList',
]);

/**
 * Decides whether a graph node describes an actual listed business.
 *
 * Identification is POSITIVE, and that matters. An earlier version matched by
 * exclusion — "the node that isn't the Organization/WebSite/WebPage/
 * BreadcrumbList" — which worked on profile pages and failed badly everywhere
 * else: a category listing page carries `Service` and `Product` nodes, so the
 * parser happily returned `companyName: "Best Electricians in Sydney NSW
 * (3 Free Quotes)"` for a page containing no business at all. Wrong data that
 * looks right is worse than no data, so a node now has to prove it is a
 * business rather than merely fail to prove it isn't.
 *
 * @param {unknown} node
 * @returns {boolean}
 */
function isTradieNode(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    typeof node['@id'] === 'string' &&
    node['@id'].endsWith(TRADIE_NODE_ID_SUFFIX)
  );
}

/**
 * Secondary test, used only when no `#tradie` node exists.
 *
 * Two conditions, both required. The node must point at a profile URL —
 * businesses live under `/connect/<key>`, while the SEO `Service` and `Product`
 * nodes on category pages reference `/find/...`. And it must not be one of the
 * structural nodes that merely *describe* the page, which share that same URL.
 *
 * Note what is deliberately NOT used: `aggregateRating` and `hasOfferCatalog`.
 * They look like business markers, but a category page's `Product` node carries
 * a rating ("4.9 from 8911 ratings") and its `Service` node carries a
 * catalogue — matching on those is what made this return an SEO headline as a
 * company name.
 *
 * @param {unknown} node
 * @returns {boolean}
 */
function isBusinessNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (STRUCTURAL_LD_TYPES.has(node['@type'])) return false;

  const url = typeof node.url === 'string' ? node.url : null;
  return url !== null && url.includes(PROFILE_URL_MARKER);
}

/**
 * Finds the schema.org node describing the listed business.
 *
 * The node's `@type` is the trade itself (`Electrician`, `Plumber`, …), so it
 * cannot be matched by type name — see `isBusinessNode` for how it is found.
 *
 * @param {string} html
 * @returns {object|null}
 */
export function readJsonLdBusiness(html) {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const [, body] of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }

    const nodes = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed].flat();

    // The `#tradie` marker wins outright, wherever it sits in the graph. Taking
    // the first node that merely looks plausible would depend on graph order —
    // and on a profile page the `WebPage` node comes first.
    const business = nodes.find(isTradieNode) ?? nodes.find(isBusinessNode);
    if (business) return business;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field readers — one per requested field
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object|null} data Hydration loader data
 * @param {object|null} ld   JSON-LD business node
 * @returns {string|null}
 */
function readCompanyName(data, ld) {
  return (
    cleanString(data?.site?.name) ??
    cleanString(data?.page?.title) ??
    cleanString(ld?.name)
  );
}

/**
 * The number is absent from the rendered DOM — the page shows a "Reveal phone
 * number" button — so the hydration payload is the only source. `page.phone`
 * is preferred because it is the number attached to the profile the visitor is
 * looking at; the location record is the fallback.
 *
 * @param {object|null} data
 * @returns {string|null}
 */
function readPhoneNumber(data) {
  return (
    cleanString(data?.page?.phone) ??
    cleanString(data?.page?.mobile) ??
    cleanString(data?.site?.primary_location?.phone) ??
    cleanString(data?.site?.primary_location?.mobile)
  );
}

/**
 * Reads the company's own website, as the profile states it.
 *
 * The value is returned VERBATIM (bar trimming) because hipages stores it
 * unnormalised — real profiles carry `"www.example.com.au/"` with no scheme,
 * alongside `""` and `null` for "none". Inventing a scheme here would mean the
 * parser reporting something the page does not say. Turning this into a
 * navigable URL is the consumer's job; see `companyProcessor.service.js`.
 *
 * @param {object|null} data
 * @returns {string|null} Raw website value, or null when the profile has none.
 */
function readWebsite(data) {
  return (
    cleanString(data?.site?.website) ?? cleanString(data?.site?.primary_location?.website)
  );
}

/**
 * @param {object|null} data
 * @returns {object|null}
 */
function readBusinessLocation(data) {
  const site = data?.site;
  const primary = site?.primary_location;
  if (!site && !primary) return null;

  const location = {
    displayAddress: cleanString(site?.address),
    suburb: cleanString(primary?.suburb) ?? cleanString(site?.suburb),
    state: cleanString(primary?.state_code) ?? cleanString(site?.state),
    postcode: primary?.zip == null ? null : String(primary.zip),
    capitalCity: cleanString(primary?.capital_city),
    serviceArea: cleanString(site?.service_area) ?? cleanString(data?.page?.service_area),
  };

  return Object.values(location).some((value) => value !== null) ? location : null;
}

/**
 * The visible "About" block renders two rich-text fields in order: the headline
 * banner, then the body copy. Both the HTML and a flattened text form are kept
 * — the HTML because it is the source of truth, the text because every
 * downstream consumer (CSV, table cell, search) wants it flat.
 *
 * @param {object|null} data
 * @returns {object|null}
 */
function readAbout(data) {
  const page = data?.page;
  if (!page) return null;

  const headlineHtml = cleanString(page.headline);
  const descriptionHtml = cleanString(page.description);
  if (!headlineHtml && !descriptionHtml) return null;

  const headlineText = htmlToText(headlineHtml);
  const descriptionText = htmlToText(descriptionHtml);

  return {
    headlineHtml,
    headlineText,
    descriptionHtml,
    descriptionText,
    text: [headlineText, descriptionText].filter(Boolean).join('\n\n') || null,
  };
}

/**
 * @param {object|null} data
 * @param {object|null} ld
 * @returns {object[]}
 */
function readServices(data, ld) {
  const categories = data?.site?.categories;
  if (Array.isArray(categories) && categories.length > 0) {
    return categories
      .map((category) => ({
        name: cleanString(category?.name),
        seoKey: cleanString(category?.seo_key),
      }))
      .filter((service) => service.name !== null);
  }

  const catalogue = ld?.hasOfferCatalog?.itemListElement;
  if (!Array.isArray(catalogue)) return [];

  return catalogue
    .map((entry) => ({ name: cleanString(entry?.item?.name), seoKey: null }))
    .filter((service) => service.name !== null);
}

/**
 * Gallery URLs keep the site's `:SIZE` token verbatim. Resolving it would mean
 * inventing a dimension the page never stated; the consumer substitutes the
 * size it actually needs.
 *
 * @param {object|null} data
 * @returns {object[]}
 */
function readGallery(data) {
  const images = data?.site?.images;
  if (!Array.isArray(images)) return [];

  return images
    .map((image) => ({
      id: image?.id ?? null,
      fileName: cleanString(image?.file_name),
      title: cleanString(image?.title),
      description: cleanString(image?.description),
      sort: toNumber(image?.sort),
      isFeatured: Boolean(toNumber(image?.featured)),
      urlTemplate: cleanString(image?.url),
      sizePlaceholder: GALLERY_SIZE_PLACEHOLDER,
    }))
    .filter((image) => image.urlTemplate !== null);
}

/**
 * The visible "Credentials" section lists the ABN and each trade licence;
 * insurance sits alongside them in the payload and is reported here too so an
 * absent policy is distinguishable from an unparsed one.
 *
 * @param {object|null} data
 * @param {object|null} ld
 * @returns {object}
 */
function readCredentials(data, ld) {
  const ldAbn =
    ld?.additionalProperty?.name === 'ABN' ? cleanString(ld.additionalProperty.value) : null;

  const licences = Array.isArray(data?.site?.licenses)
    ? data.site.licenses
        .map((licence) => ({
          name: cleanString(licence?.name),
          number: cleanString(licence?.number),
          verified: Boolean(licence?.verified),
          verificationUrl: cleanString(licence?.url),
        }))
        .filter((licence) => licence.name !== null || licence.number !== null)
    : [];

  return {
    abn: cleanString(data?.site?.abn) ?? ldAbn,
    licences,
    insurance: {
      hasPublicLiability: Boolean(data?.insurances?.hasPublicLiability),
      types: Array.isArray(data?.insurances?.types) ? data.insurances.types : [],
    },
  };
}

/**
 * The hipages rating specifically — the page also carries an aggregated Google
 * score, which is a different number and is not what this field means.
 *
 * @param {object|null} data
 * @param {object|null} ld
 * @returns {object|null}
 */
function readHipagesRating(data, ld) {
  const rating = data?.site?.rating;
  const summary = data?.reviewsSummary?.sourceSummaries?.hipages;
  const aggregate = ld?.aggregateRating;

  const ratingValue =
    toNumber(rating?.star_rating) ?? toNumber(summary?.average) ?? toNumber(aggregate?.ratingValue);
  const ratingCount =
    toNumber(rating?.ratings) ??
    toNumber(summary?.totalReviewCount) ??
    toNumber(aggregate?.ratingCount);

  if (ratingValue === null && ratingCount === null) return null;

  return {
    ratingValue,
    ratingCount,
    bestRating: toNumber(aggregate?.bestRating),
    worstRating: toNumber(aggregate?.worstRating),
    hiredCount: toNumber(rating?.hired) ?? toNumber(summary?.hiresCount),
    recommendations: {
      total: toNumber(rating?.recommendations),
      positive: toNumber(rating?.recommend_yes),
      negative: toNumber(rating?.recommend_no),
    },
  };
}

/**
 * Reviews come from the payload rather than JSON-LD because the payload carries
 * every review the page holds, each with its date, suburb and job category;
 * the JSON-LD block publishes only a trimmed selection. JSON-LD still backs it
 * up so a payload change costs detail, not the field.
 *
 * @param {object|null} data
 * @param {object|null} ld
 * @returns {object[]}
 */
function readReviews(data, ld) {
  const items = data?.hipagesReviews?.items;
  if (Array.isArray(items) && items.length > 0) {
    return items.map((item) => ({
      id: cleanString(item?.id),
      reviewerName: cleanString(item?.reviewerName),
      reviewerLocation: cleanString(item?.reviewerLocation),
      comment: cleanString(item?.comment),
      starRating: toNumber(item?.starRating),
      postedAt: cleanString(item?.postedAt),
      categoryName: cleanString(item?.categoryName),
      jobId: cleanString(item?.jobId),
      isVerified: Boolean(item?.isHipagesVerified),
      wasHired: Boolean(item?.hired),
      source: cleanString(item?.source),
    }));
  }

  const ldReviews = Array.isArray(ld?.review) ? ld.review : [];
  return ldReviews.map((review) => ({
    id: cleanString(review?.['@id']),
    reviewerName: cleanString(review?.author?.name),
    reviewerLocation: null,
    comment: cleanString(review?.reviewBody),
    starRating: toNumber(review?.reviewRating?.ratingValue),
    postedAt: null,
    categoryName: null,
    jobId: null,
    isVerified: false,
    wasHired: false,
    source: 'jsonld',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public parse functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} HipagesProfile
 * @property {string|null} companyName
 * @property {string|null} phoneNumber
 * @property {string|null} website Raw, un-normalised — may lack a scheme
 * @property {object|null} businessLocation
 * @property {object|null} about
 * @property {object[]}    services
 * @property {object[]}    gallery
 * @property {object}      credentials
 * @property {object|null} hipagesRating
 * @property {object[]}    reviews
 */

/**
 * Parses one saved business profile page into a structured object.
 *
 * Reads only the nine requested fields. A field the page does not carry comes
 * back `null` (or an empty array for the list fields) rather than throwing —
 * a profile legitimately missing a gallery is not a parse failure. The one
 * genuine failure is a page carrying neither embedded source, which means the
 * markup is not a hipages profile at all.
 *
 * @param {string} html Raw profile-page markup
 * @returns {HipagesProfile}
 * @throws {ApiError} When the markup contains no recognisable profile data.
 */
export function parseProfilePage(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw ApiError.badRequest('hipages.parser.parseProfilePage() requires non-empty HTML.', {
      sourceId: 'hipages',
      module: 'parser',
      fn: 'parseProfilePage',
    });
  }

  const data = readHydrationData(html);
  const ld = readJsonLdBusiness(html);

  if (!data && !ld) {
    throw ApiError.badRequest(
      'No hipages profile data found — the page carries neither a hydration payload nor a JSON-LD business node.',
      {
        sourceId: 'hipages',
        module: 'parser',
        fn: 'parseProfilePage',
        detail: 'Likely not a profile page, or a guard/interstitial page was captured instead.',
      },
    );
  }

  return {
    companyName: readCompanyName(data, ld),
    phoneNumber: readPhoneNumber(data),
    website: readWebsite(data),
    businessLocation: readBusinessLocation(data),
    about: readAbout(data),
    services: readServices(data, ld),
    gallery: readGallery(data),
    credentials: readCredentials(data, ld),
    hipagesRating: readHipagesRating(data, ld),
    reviews: readReviews(data, ld),
  };
}

/**
 * Parses a results page into an array of listing stubs.
 *
 * A "stub" is whatever the card exposes — name, profile URL, rating, location
 * — without opening the profile. For jobs running `includeDetails: 'listing'`,
 * this is the complete data set.
 *
 * @param {string} _html Raw results-page markup
 * @returns {object[]} Loose, un-normalised listing stubs
 * @throws {ApiError} Always — not implemented.
 */
export function parseListingPage(_html) {
  throw notImplemented(
    'parseListingPage',
    'Must map each listingSelectors.card match to a stub; requires selectors.js to be filled in first.',
  );
}

/**
 * Reads pagination state from a results page.
 *
 * Kept separate from `parseListingPage` so the crawler can ask "is there a next
 * page?" without paying to parse every card on it.
 *
 * @param {string} _html
 * @returns {{ currentPage: number|null, nextPageHref: string|null, isLastPage: boolean }}
 * @throws {ApiError} Always — not implemented.
 */
export function parsePagination(_html) {
  throw notImplemented(
    'parsePagination',
    'Must report isLastPage from a positive signal, not merely a missing next link.',
  );
}

/**
 * Classifies a page before anything tries to read data from it.
 *
 * This runs FIRST in the parse step. Without it, a CAPTCHA or rate-limit page
 * parses as zero cards and the job reports "0 results found" — indistinguishable
 * from a genuinely empty search. That failure mode silently corrupts data sets,
 * so the guard is mandatory rather than defensive polish.
 *
 * @param {string} _html
 * @returns {{ ok: boolean, reason: 'captcha'|'blocked'|'empty'|null }}
 * @throws {ApiError} Always — not implemented.
 */
export function detectPageGuard(_html) {
  throw notImplemented(
    'detectPageGuard',
    'Must distinguish captcha / blocked / legitimately-empty; see guardSelectors.',
  );
}

export const parser = {
  parseProfilePage,
  parseListingPage,
  parsePagination,
  detectPageGuard,
  readHydrationData,
  readJsonLdBusiness,
};

export default parser;
