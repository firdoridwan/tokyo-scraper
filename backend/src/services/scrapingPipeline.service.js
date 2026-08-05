/**
 * Scraping pipeline.
 *
 * The one place where the finished pieces are wired together:
 *
 *   category URL
 *     → crawler.collectListingUrls()   profile URLs                 (listing collector)
 *     → companyProcessor.processCompanies()                          (profile → parse → visit)
 *         ├ crawler.fetchProfilePage() + parser.parseProfilePage()
 *         └ websiteVisitor.visitWebsite()   only when a website exists
 *     → emailExtractor.extractEmail()  one address per company       (email extractor)
 *     → one record per company
 *
 * It owns no scraping logic. Everything here is sequencing, one derived field
 * (`status`), and the record shape. If a behaviour looks like it belongs to a
 * step — how a listing is paginated, when a website counts as present, how far
 * an email search may crawl — it lives in that step's module and is not
 * re-decided here.
 *
 * Two phases, and why the browser closes between them
 * ---------------------------------------------------
 * Phase 1 (collect + process) needs one long-lived hipages page; phase 2 (email
 * extraction) needs none — it reads homepage captures back off disk and only
 * opens a browser when the extractor decides to follow a contact page. So the
 * hipages browser is closed the moment the last profile is done, rather than
 * idling through phase 2.
 *
 * The cost of the split is that per-company records appear during phase 2, not
 * while profiles are being read. That is a reporting nicety; holding a browser
 * open for it is not worth it.
 *
 * Failure isolation
 * -----------------
 * A company that fails produces a record with `status: 'failed'` and the
 * message in `error` — never a thrown exception, never a missing row. The
 * isolation itself is the company processor's, already implemented and tested;
 * this module surfaces it rather than repeating it.
 *
 * Deliberately out of scope: SQLite, CSV, the API, the frontend. The pipeline
 * returns records and a summary; who stores them is a later sprint's question.
 *
 * Usage
 * -----
 *   node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [limit]
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { collectListingUrls } from '../scrapers/hipages/crawler.js';
import { processCompanies } from './companyProcessor.service.js';
import { extractEmail } from './emailExtractor.service.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'scrapingPipeline' });

const VIEWPORT = { width: 1440, height: 900 };

/** @typedef {'success'|'skipped'|'failed'} CompanyStatus */

/**
 * @typedef {object} CompanyRecord
 * @property {string|null} companyName
 * @property {string|null} phoneNumber
 * @property {string|null} website        Navigable URL, or null when none is listed
 * @property {string|null} email
 * @property {object|null} businessLocation
 * @property {object|null} about
 * @property {object[]}    services
 * @property {object}      credentials
 * @property {object|null} hipagesRating
 * @property {object[]}    reviews
 * @property {object[]}    gallery
 * @property {string}      hipagesUrl
 * @property {boolean}     websiteCaptured Homepage HTML + screenshot were saved
 * @property {CompanyStatus} status
 * @property {string|null} error          Why this company failed, when it did
 */

/**
 * @typedef {object} PipelineSummary
 * @property {number} discovered  Profile URLs the listing collector found
 * @property {number} processed   Companies actually attempted (after `limit`)
 * @property {number} skipped     Companies whose profile lists no website
 * @property {number} failed      Companies that errored
 * @property {number} emailsFound Companies with an email address
 */

/** Empty credentials, matching the parser's shape, for a company that failed. */
const NO_CREDENTIALS = Object.freeze({
  abn: null,
  licences: [],
  insurance: { hasPublicLiability: false, types: [] },
});

/**
 * Derives the outcome of one company.
 *
 * Three states, and the order matters: a company that errored is `failed` even
 * if it also had no website, because the error is the more informative fact.
 *
 * `skipped` means the profile was read fine and simply lists no website — the
 * record still carries the full hipages data, so "skipped" describes the
 * website/email half of the pipeline, not the company.
 *
 * @param {import('./companyProcessor.service.js').CompanyResult} result
 * @returns {CompanyStatus}
 */
function toStatus(result) {
  if (result.error) return 'failed';
  if (result.skippedReason === 'no-website') return 'skipped';
  return 'success';
}

/**
 * Assembles the final object for one company.
 *
 * Pure — takes what the earlier steps produced and reshapes it. Nothing is
 * fetched, inferred or defaulted to a plausible value: a field the profile did
 * not carry stays null, and a company that failed yields a record of nulls
 * rather than being dropped, so the count of records always matches the count
 * of companies attempted.
 *
 * `website` is the navigable URL the processor resolved, not the raw profile
 * text — hipages stores it scheme-less (`"www.example.com.au/"`), and the
 * resolution rule already exists in `resolveWebsiteUrl()`. When resolution
 * failed there is no usable website, which is exactly what null means here.
 *
 * @param {import('./companyProcessor.service.js').CompanyResult} result
 * @param {import('./emailExtractor.service.js').EmailResult} email
 * @param {string|null} [emailError] Message when the email step itself broke
 * @returns {CompanyRecord}
 */
export function buildCompanyRecord(result, email, emailError = null) {
  const profile = result.profile;

  return {
    companyName: profile?.companyName ?? result.companyName ?? null,
    phoneNumber: profile?.phoneNumber ?? null,
    website: result.websiteUrl ?? null,
    email: email?.email ?? null,
    businessLocation: profile?.businessLocation ?? null,
    about: profile?.about ?? null,
    services: profile?.services ?? [],
    credentials: profile?.credentials ?? NO_CREDENTIALS,
    hipagesRating: profile?.hipagesRating ?? null,
    reviews: profile?.reviews ?? [],
    gallery: profile?.gallery ?? [],
    hipagesUrl: result.profileUrl,
    websiteCaptured: result.websiteVisited,
    status: toStatus(result),
    error: result.error ?? emailError,
  };
}

/**
 * Counts the run.
 *
 * @param {CompanyRecord[]} records
 * @param {number} discovered
 * @returns {PipelineSummary}
 */
export function summarise(records, discovered) {
  return {
    discovered,
    processed: records.length,
    skipped: records.filter((record) => record.status === 'skipped').length,
    failed: records.filter((record) => record.status === 'failed').length,
    emailsFound: records.filter((record) => record.email !== null).length,
  };
}

/**
 * Runs the email extractor against a homepage the processor already captured.
 *
 * The capture is read from disk rather than re-visited — the whole reason the
 * visitor writes a file is so nobody opens that page twice.
 *
 * @param {import('./companyProcessor.service.js').CompanyResult} result
 * @returns {Promise<{ email: import('./emailExtractor.service.js').EmailResult, error: string|null }>}
 */
async function extractEmailFor(result) {
  if (!result.websiteVisited || !result.htmlPath) {
    return { email: { email: null }, error: null };
  }

  try {
    const html = await fs.readFile(result.htmlPath, 'utf8');
    const email = await extractEmail({
      html,
      pageUrl: result.finalUrl ?? result.websiteUrl,
    });
    return { email, error: null };
  } catch (error) {
    // The company's hipages data is still good; only its email is unknown. The
    // failure is recorded on the record instead of discarding everything else.
    log.warn('Email extraction failed', {
      company: result.companyName,
      message: error.message,
    });
    return { email: { email: null }, error: error.message };
  }
}

/**
 * Runs the whole pipeline.
 *
 * @param {{
 *   categoryUrl?: string,
 *   category?: string,
 *   location?: string,
 *   maxPages?: number,
 *   profileUrls?: string[],
 *   limit?: number
 * }} params Either a category to collect from, or explicit profile URLs.
 * @param {{
 *   signal?: AbortSignal,
 *   onDiscovered?: (info: { profileUrls: string[], discovered: number }) => void,
 *   onCompany?: (record: CompanyRecord, index: number, total: number) => void
 * }} [options]
 * @returns {Promise<{ records: CompanyRecord[], summary: PipelineSummary }>}
 */
export async function runPipeline(params = {}, options = {}) {
  const browser = await chromium.launch({ headless: config.scraper.headless });

  /** @type {import('./companyProcessor.service.js').CompanyResult[]} */
  let results = [];
  let discovered = 0;

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: config.scraper.userAgent,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.scraper.navigationTimeoutMs);

    let profileUrls = params.profileUrls ?? [];

    if (profileUrls.length === 0) {
      const collected = await collectListingUrls(
        page,
        {
          listingUrl: params.categoryUrl,
          category: params.category,
          location: params.location,
          maxPages: params.maxPages,
        },
        { signal: options.signal },
      );
      profileUrls = collected.profileUrls;
      log.info('Discovered companies', {
        discovered: profileUrls.length,
        pagesVisited: collected.pagesVisited,
        terminationReason: collected.terminationReason,
      });
    }

    discovered = profileUrls.length;
    // `limit` caps the work, not the discovery count — "found 47, processed 5"
    // is the honest report, and hiding the 47 would misstate the source.
    const selected = params.limit ? profileUrls.slice(0, params.limit) : profileUrls;

    options.onDiscovered?.({ profileUrls: selected, discovered });

    if (selected.length > 0) {
      ({ results } = await processCompanies(page, selected, { signal: options.signal }));
    }
  } finally {
    await browser.close();
    log.info('hipages browser closed');
  }

  /** @type {CompanyRecord[]} */
  const records = [];

  for (const [position, result] of results.entries()) {
    if (options.signal?.aborted) {
      log.warn('Pipeline aborted during email extraction', {
        completed: records.length,
        total: results.length,
      });
      break;
    }

    const { email, error } = await extractEmailFor(result);
    const record = buildCompanyRecord(result, email, error);
    records.push(record);
    options.onCompany?.(record, position + 1, results.length);
  }

  return { records, summary: summarise(records, discovered) };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [categoryUrl, rawLimit] = process.argv.slice(2);

  if (!categoryUrl) {
    process.stderr.write(
      'Usage: node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [limit]\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    const { records, summary } = await runPipeline({ categoryUrl, limit });
    process.stdout.write(`${JSON.stringify({ summary, records }, null, 2)}\n`);
  } catch (error) {
    log.error('Pipeline failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export const scrapingPipeline = { runPipeline, buildCompanyRecord, summarise };

export default scrapingPipeline;
