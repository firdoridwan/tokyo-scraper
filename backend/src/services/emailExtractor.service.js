/**
 * Email extractor.
 *
 * Reads ONE email address out of a company website that the website visitor has
 * already captured. Nothing here opens a browser for the homepage — that page
 * exists on disk by the time this runs, and re-fetching it would be a second
 * request for bytes we already hold.
 *
 * The search, in order
 * --------------------
 *   1. homepage — `mailto:` links
 *   2. homepage — visible text
 *   3. homepage — `href` values
 *   4. homepage — plain email regex over the raw markup
 *   5. ONE internal contact/about/support page, searched with the same 1–4
 *
 * The first hit wins and the search stops. Steps 1–3 are subsets of step 4, so
 * they exist for provenance, not for coverage: `foundOn` should say `mailto`
 * when the site published a real mail link, and only fall back to `regex` when
 * the address was scraped out of an attribute or a script blob. Knowing which
 * one it was is the difference between a trustworthy address and a guess.
 *
 * Crawl budget: exactly one extra page, ever
 * ------------------------------------------
 * When the homepage yields nothing, exactly ONE internal link is followed — the
 * first whose text or href reads like a contact page. Not the first three, not
 * "contact then about", not a queue. If that page has no email either, the
 * answer is `null`. External links are never followed, and the site is never
 * crawled.
 *
 * That one extra page is fetched through the existing website visitor, unchanged
 * and un-wrapped: it already knows how to launch the browser, settle the page,
 * follow redirects and write the capture. Re-implementing a fetcher here would
 * duplicate it, and modifying it is out of scope.
 *
 * No AI, no OCR, no heuristics beyond the four passes above. An address that is
 * not in the markup is reported as absent, never inferred from the domain.
 *
 * Usage
 * -----
 *   node backend/src/services/emailExtractor.service.js "<htmlPath>" "<pageUrl>"
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { visitWebsite } from './websiteVisitor.service.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'emailExtractor' });

/**
 * Standard email pattern — deliberately the common, conservative one.
 *
 * It is applied to markup, not to a validated input field, so it errs towards
 * shapes that actually appear on business websites rather than towards RFC 5322
 * completeness. Quoted local parts and IP-literal domains do not appear on a
 * tradesman's contact page.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}/g;

/** `mailto:` targets, quoted or bare, including inside escaped script strings. */
const MAILTO_PATTERN = /mailto:([^"'\s<>\\)]+)/gi;

/** `href` attribute values. */
const HREF_PATTERN = /\shref\s*=\s*["']([^"']+)["']/gi;

/** Anchors, with their inner markup — used to find the one internal page. */
const ANCHOR_PATTERN = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Words that mark a link as worth following, exactly as specified for this
 * sprint. Matching is substring-based, so `contact` already covers `contact-us`
 * and `contactus`; both are kept here so the list stays readable as the rule it
 * came from.
 */
const CONTACT_KEYWORDS = Object.freeze([
  'contact',
  'contact-us',
  'contactus',
  'about',
  'support',
]);

/**
 * Suffixes that mean "this string matched the email pattern but is not an email
 * address". Every entry was observed in a real capture under `data/websites`:
 *
 * - `wixpress.com` / `sentry.io` — Sentry DSN keys embedded by site builders.
 *   `data/websites/…_www-emcoelectrical-net-au/website.html` carries eight of
 *   them, e.g. `0e6a29e4756740a8a63493e912ba2174@sentry.wixpress.com`. Returned
 *   as a contact address, that is simply wrong data.
 * - the placeholder domains — form hints such as `you@domain.com`, which the
 *   github.com capture shows verbatim.
 *
 * This list removes noise; it never adds or repairs an address.
 */
const NON_CONTACT_DOMAINS = Object.freeze([
  'wixpress.com',
  'sentry.io',
  'example.com',
  'example.org',
  'example.net',
  'domain.com',
  'yourdomain.com',
  'yourcompany.com',
]);

/**
 * File extensions that the email pattern happily mistakes for a TLD — CSS
 * `url(logo@2x.png)` and retina asset names being the usual culprits.
 */
const ASSET_EXTENSIONS = Object.freeze([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'css',
  'js',
  'json',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'mp4',
  'webm',
  'pdf',
]);

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes the entity forms an address can hide behind.
 *
 * `&#64;` for `@` is the oldest email-obfuscation trick on the web and it is
 * still in use; without this the address is simply invisible to the pattern.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Percent-decoding that never throws — `%` appears unescaped in real hrefs.
 *
 * @param {string} value
 * @returns {string}
 */
function decodePercent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Reduces markup to the text a visitor actually reads.
 *
 * Scripts, styles and comments go first: they are where the noise lives (inline
 * JSON, tracking config, commented-out markup), and an address found in them is
 * not "visible text" by any reading.
 *
 * @param {string} html
 * @returns {string}
 */
function toVisibleText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * Decides whether a pattern match is a usable contact address.
 *
 * @param {string} email Already lower-cased
 * @returns {boolean}
 */
function isUsableEmail(email) {
  const [, domain] = email.split('@');
  if (!domain || !domain.includes('.')) return false;

  const extension = domain.slice(domain.lastIndexOf('.') + 1);
  if (ASSET_EXTENSIONS.includes(extension)) return false;

  // Suffix match, so `sentry.wixpress.com` is caught by `wixpress.com`.
  return !NON_CONTACT_DOMAINS.some(
    (blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
  );
}

/**
 * Returns the first usable address in a chunk of text, or null.
 *
 * @param {string} text
 * @returns {string|null}
 */
function firstEmailIn(text) {
  if (typeof text !== 'string' || text === '') return null;

  for (const match of text.matchAll(EMAIL_PATTERN)) {
    // A trailing dot survives the pattern only as part of a longer TLD-looking
    // run, but a trailing hyphen does not — trim both rather than emit `x@y.com-`.
    const email = match[0].toLowerCase().replace(/[.-]+$/, '');
    if (isUsableEmail(email)) return email;
  }
  return null;
}

/**
 * Pass 1 — `mailto:` links.
 *
 * The target is percent-decoded (Wix and Squarespace both emit
 * `mailto:info%40example.com`) and the query string is dropped, so a link
 * carrying `?subject=Enquiry` still yields a clean address.
 *
 * @param {string} html
 * @returns {string|null}
 */
function findInMailto(html) {
  for (const [, target] of html.matchAll(MAILTO_PATTERN)) {
    const address = decodePercent(decodeEntities(target)).split('?')[0];
    const email = firstEmailIn(address);
    if (email) return email;
  }
  return null;
}

/**
 * Pass 3 — `href` values other than `mailto:`.
 *
 * Contact-form endpoints and third-party enquiry widgets routinely carry the
 * address as a query parameter (`?to=info@example.com`), which is a published
 * address even though it is not a mail link.
 *
 * @param {string} html
 * @returns {string|null}
 */
function findInHrefs(html) {
  for (const [, href] of html.matchAll(HREF_PATTERN)) {
    if (/^\s*mailto:/i.test(href)) continue;
    const email = firstEmailIn(decodePercent(decodeEntities(href)));
    if (email) return email;
  }
  return null;
}

/**
 * @typedef {object} EmailHit
 * @property {string} email
 * @property {'mailto'|'text'|'href'|'regex'} foundOn
 */

/**
 * Runs all four passes over one page's markup.
 *
 * @param {string} html
 * @returns {EmailHit|null}
 */
export function findEmailInHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') return null;

  const mailto = findInMailto(html);
  if (mailto) return { email: mailto, foundOn: 'mailto' };

  const text = firstEmailIn(toVisibleText(html));
  if (text) return { email: text, foundOn: 'text' };

  const href = findInHrefs(html);
  if (href) return { email: href, foundOn: 'href' };

  const raw = firstEmailIn(decodeEntities(html));
  if (raw) return { email: raw, foundOn: 'regex' };

  return null;
}

/** @param {string} hostname */
const bareHost = (hostname) => hostname.toLowerCase().replace(/^www\./, '');

/**
 * Finds the ONE internal page worth opening when the homepage had no address.
 *
 * "First matching" is meant literally: anchors are read in document order and
 * the first one whose href or link text contains a keyword wins. No ranking of
 * `contact` above `about` — the sprint asks for the first match, and inventing
 * a preference order would be a product decision.
 *
 * A link is rejected when it leaves the site (different host), is not http(s)
 * (`tel:`, `mailto:`, `javascript:`), or resolves back to the page already
 * searched — re-opening the homepage under a `#contact` anchor would burn the
 * single-page budget on markup already in hand.
 *
 * @param {string} html    Homepage markup
 * @param {string} pageUrl Absolute URL the markup was captured from
 * @returns {string|null}  Absolute URL of the page to open, or null
 */
export function findInternalPageUrl(html, pageUrl) {
  if (typeof html !== 'string' || html.trim() === '') return null;

  let base;
  try {
    base = new URL(pageUrl);
  } catch {
    return null;
  }

  for (const [, href, inner] of html.matchAll(ANCHOR_PATTERN)) {
    const linkText = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).toLowerCase();
    const rawHref = decodeEntities(href).trim();
    const haystack = `${rawHref.toLowerCase()} ${linkText}`;

    if (!CONTACT_KEYWORDS.some((keyword) => haystack.includes(keyword))) continue;

    let candidate;
    try {
      candidate = new URL(rawHref, base);
    } catch {
      continue;
    }

    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') continue;
    if (bareHost(candidate.hostname) !== bareHost(base.hostname)) continue;

    candidate.hash = '';
    if (candidate.href.replace(/\/$/, '') === base.href.replace(/\/$/, '')) continue;

    return candidate.href;
  }

  return null;
}

/**
 * Path shown as `sourcePage`, e.g. `/contact`.
 *
 * @param {string} pageUrl
 * @returns {string|null}
 */
function toSourcePage(pageUrl) {
  try {
    return new URL(pageUrl).pathname || '/';
  } catch {
    return null;
  }
}

/**
 * Opens one page through the website visitor and hands back its markup.
 *
 * The visitor writes the capture to disk and returns paths, so the HTML is read
 * back from the file it just wrote. That is deliberate: the alternative is
 * changing the visitor's return value, and the visitor is not to be modified.
 *
 * @param {string} url
 * @returns {Promise<{ html: string, finalUrl: string }>}
 */
async function visitAndRead(url) {
  const capture = await visitWebsite(url);
  const html = await fs.readFile(capture.htmlPath, 'utf8');
  return { html, finalUrl: capture.finalUrl ?? url };
}

/**
 * @typedef {object} EmailResult
 * @property {string|null} email      Address, or null when the site publishes none
 * @property {string}      [sourcePage] Path it was found on, e.g. `/contact`
 * @property {'mailto'|'text'|'href'|'regex'} [foundOn]
 */

/**
 * Extracts one email address for one company website.
 *
 * @param {{ html: string, pageUrl: string }} capture Homepage markup as saved by
 *   the website visitor, plus the URL that actually responded.
 * @param {{ fetchPage?: (url: string) => Promise<{ html: string, finalUrl: string }> }} [options]
 *   `fetchPage` overrides how the single extra page is opened. It exists so the
 *   follow-up path can be tested without a browser; production uses the website
 *   visitor.
 * @returns {Promise<EmailResult>} `{ email, sourcePage, foundOn }` on a hit,
 *   `{ email: null }` otherwise.
 */
export async function extractEmail(capture, options = {}) {
  const { html, pageUrl } = capture ?? {};
  const fetchPage = options.fetchPage ?? visitAndRead;

  const onHomepage = findEmailInHtml(html);
  if (onHomepage) {
    return {
      email: onHomepage.email,
      sourcePage: toSourcePage(pageUrl),
      foundOn: onHomepage.foundOn,
    };
  }

  const internalUrl = findInternalPageUrl(html, pageUrl);
  if (!internalUrl) {
    log.info('No email on the homepage and no internal contact link', { pageUrl });
    return { email: null };
  }

  log.info('Following one internal page', { pageUrl, internalUrl });

  let page;
  try {
    page = await fetchPage(internalUrl);
  } catch (error) {
    // A dead contact page is an absent address, not a failed company. The rest
    // of the batch — and the rest of this company's data — is still good.
    log.warn('Internal page could not be opened', { internalUrl, message: error.message });
    return { email: null };
  }

  const onInternal = findEmailInHtml(page.html);
  if (!onInternal) return { email: null };

  return {
    email: onInternal.email,
    sourcePage: toSourcePage(page.finalUrl),
    foundOn: onInternal.foundOn,
  };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [htmlPath, pageUrl] = process.argv.slice(2);

  if (!htmlPath || !pageUrl) {
    process.stderr.write(
      'Usage: node backend/src/services/emailExtractor.service.js "<htmlPath>" "<pageUrl>"\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const html = await fs.readFile(htmlPath, 'utf8');
    const result = await extractEmail({ html, pageUrl });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    log.error('Email extraction failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export const emailExtractor = { extractEmail, findEmailInHtml, findInternalPageUrl };

export default emailExtractor;
