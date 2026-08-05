/**
 * Company processor.
 *
 * Takes the profile URLs produced by the listing collector and, for each one:
 * opens the hipages profile, parses it, and — only when the company actually
 * lists a website — captures that website's homepage.
 *
 * Composition, not implementation
 * -------------------------------
 * This service owns no scraping logic of its own. It sequences three existing
 * pieces and adds the decision between them:
 *
 *   crawler.fetchProfilePage()   → markup            (hipages navigation)
 *   parser.parseProfilePage()    → structured fields (markup interpretation)
 *   websiteVisitor.visitWebsite()→ saved artefacts   (third-party capture)
 *
 * The one piece of genuinely new logic is `resolveWebsiteUrl()`, and it exists
 * because those two components disagree about what a URL is — see below.
 *
 * Failure isolation
 * -----------------
 * A batch is worth more than any single company in it. One profile that 404s,
 * times out, or serves an unparseable page must not abort the other nine, so
 * every company is processed inside its own try/catch and its failure is
 * recorded as a result rather than thrown. The run reports how many failed, so
 * "processed 10" never quietly means "8 worked and 2 vanished".
 *
 * Scope
 * -----
 * No emails, no SQLite, no CSV, no API or frontend changes. Exactly one page is
 * opened per company website — the homepage — and no link on it is followed.
 */
import { fetchProfilePage } from '../scrapers/hipages/crawler.js';
import { parseProfilePage } from '../scrapers/hipages/parser.js';
import { visitWebsite } from './websiteVisitor.service.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'companyProcessor' });

/**
 * Turns the profile's website value into something navigable.
 *
 * hipages stores this field as free text, and real profiles prove it: of ten
 * electricians sampled on 2026-08-04, five listed a site and every one of them
 * was scheme-less — `"www.emcoelectrical.net.au/"`,
 * `"greatersydneyelectrical.com.au/"`. The website visitor, correctly, rejects
 * anything without an http/https scheme. Without this step the processor would
 * report "website found" and then fail to visit every single one.
 *
 * `https` is assumed when no scheme is given rather than `http`, since the
 * visitor follows redirects and a site that only serves plaintext will send the
 * browser there anyway.
 *
 * Returns `null` for values that are not plausibly a domain, so placeholder
 * junk ("n/a", "none") is treated as "no website" instead of a failed visit.
 *
 * @param {string|null|undefined} rawWebsite Value as the parser read it
 * @returns {string|null} Absolute URL, or null when there is nothing to visit
 */
export function resolveWebsiteUrl(rawWebsite) {
  if (typeof rawWebsite !== 'string') return null;

  const trimmed = rawWebsite.trim();
  if (trimmed === '') return null;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // A hostname with no dot is not a public site — it is a typo or a placeholder.
  if (!url.hostname.includes('.')) return null;

  return url.href;
}

/**
 * @typedef {object} CompanyResult
 * @property {number}      index          1-based position in the batch
 * @property {string}      profileUrl
 * @property {import('../scrapers/hipages/parser.js').HipagesProfile|null} profile
 *   Everything the parser read, verbatim. Exposed because the profile is parsed
 *   here and nowhere else: a consumer that wanted the phone number or the
 *   reviews would otherwise have to re-fetch and re-parse the same page.
 * @property {string|null} companyName
 * @property {string|null} website        Raw value from the profile
 * @property {string|null} websiteUrl     Navigable form, or null
 * @property {boolean}     websiteFound
 * @property {boolean}     websiteVisited
 * @property {string|null} htmlPath       Captured homepage HTML
 * @property {string|null} screenshotPath
 * @property {string|null} finalUrl       After redirects
 * @property {'no-website'|null} skippedReason
 * @property {string|null} error          Message when this company failed
 */

/**
 * @typedef {object} ProcessSummary
 * @property {number} processed Companies attempted
 * @property {number} skipped   Companies with no website
 * @property {number} visited   Company homepages captured
 * @property {number} failed    Companies that errored
 */

/**
 * Processes one company: profile → parse → conditional website capture.
 *
 * @param {object} context Playwright page for hipages (injected)
 * @param {string} profileUrl
 * @param {number} index 1-based
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<CompanyResult>}
 */
async function processCompany(context, profileUrl, index, options = {}) {
  /** @type {CompanyResult} */
  const result = {
    index,
    profileUrl,
    profile: null,
    companyName: null,
    website: null,
    websiteUrl: null,
    websiteFound: false,
    websiteVisited: false,
    htmlPath: null,
    screenshotPath: null,
    finalUrl: null,
    skippedReason: null,
    error: null,
  };

  try {
    const html = await fetchProfilePage(context, profileUrl, options);
    const profile = parseProfilePage(html);

    result.profile = profile;
    result.companyName = profile.companyName;
    result.website = profile.website;
    result.websiteUrl = resolveWebsiteUrl(profile.website);
    result.websiteFound = result.websiteUrl !== null;

    if (!result.websiteFound) {
      result.skippedReason = 'no-website';
      log.info('No website listed — skipping visit', { profileUrl, company: result.companyName });
      return result;
    }

    options.signal?.throwIfAborted();

    const capture = await visitWebsite(result.websiteUrl);
    result.websiteVisited = true;
    result.htmlPath = capture.htmlPath;
    result.screenshotPath = capture.screenshotPath;
    result.finalUrl = capture.finalUrl;
    log.info('Captured company website', {
      company: result.companyName,
      finalUrl: capture.finalUrl,
    });
  } catch (error) {
    result.error = error.message;
    log.warn('Company failed', { profileUrl, message: error.message });
  }

  return result;
}

/**
 * Processes a batch of hipages profile URLs.
 *
 * Sequential by design. Each company already opens up to two browsers' worth of
 * work, and the run is a courtesy visit to third-party sites — parallelising it
 * would multiply load on hipages and on every company's server for a saving
 * nobody asked for. The configured request delay is applied between companies.
 *
 * @param {object} context Playwright page for hipages (injected)
 * @param {string[]} profileUrls
 * @param {{ signal?: AbortSignal, delayMs?: number, onProgress?: (r: CompanyResult, total: number) => void }} [options]
 * @returns {Promise<{ results: CompanyResult[], summary: ProcessSummary }>}
 */
export async function processCompanies(context, profileUrls, options = {}) {
  const urls = Array.isArray(profileUrls) ? profileUrls : [];
  const delayMs = options.delayMs ?? config.scraper.requestDelayMs;

  /** @type {CompanyResult[]} */
  const results = [];

  for (const [position, profileUrl] of urls.entries()) {
    if (options.signal?.aborted) {
      log.warn('Batch aborted', { completed: results.length, total: urls.length });
      break;
    }

    // Politeness delay between companies — never before the first one.
    if (position > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const result = await processCompany(context, profileUrl, position + 1, options);
    results.push(result);
    options.onProgress?.(result, urls.length);
  }

  const summary = {
    processed: results.length,
    skipped: results.filter((r) => r.skippedReason === 'no-website').length,
    visited: results.filter((r) => r.websiteVisited).length,
    failed: results.filter((r) => r.error !== null).length,
  };

  return { results, summary };
}

export const companyProcessor = { processCompanies, resolveWebsiteUrl };

export default companyProcessor;
