/**
 * Scraping pipeline.
 *
 * The one place where the finished pieces are wired together:
 *
 *   category URL
 *     → crawler.collectListingUrls()   profile URLs                 (listing collector)
 *     → for EVERY discovered company:
 *         ├ companyProcessor.processCompany()                        (profile → parse → visit)
 *         │   ├ crawler.fetchProfilePage() + parser.parseProfilePage()
 *         │   └ websiteVisitor.visitWebsite()   only when a website exists
 *         └ emailExtractor.extractEmail()  one address per company   (email extractor)
 *     → one record per company, and a mode that decides which records leave
 *
 * It owns no scraping logic. Everything here is sequencing, one derived field
 * (`status`), the record shape, and the two decisions below. If a behaviour
 * looks like it belongs to a step — how a listing is paginated, when a website
 * counts as present, how far an email search may crawl — it lives in that
 * step's module and is not re-decided here.
 *
 * What the run is for
 * -------------------
 * Every company hipages will hand over is opened and checked. There is no
 * target and no early stop: the loop ends when the source is exhausted or when
 * the caller cancels, and nothing else. A run therefore costs the same whatever
 * the operator asked for, and two runs of the same category do the same work.
 *
 * The one thing the operator chooses is the SCRAPING MODE, and it decides a
 * single question — which of the checked companies become rows:
 *
 *   `all`         every company that did not error. A company with no website,
 *                 or with a website that publishes no address, is a row with an
 *                 empty Email cell (and, for the former, an empty Website cell).
 *   `with-email`  only companies with a valid email.
 *
 * That is the whole of the difference. Both modes discover the same companies,
 * process the same companies, report the same progress, and write the same two
 * files in the same layout — they differ only in the length of the array handed
 * to the exporters.
 *
 * One predicate, one place
 * ------------------------
 * `isExportable()` is the only function that answers "does this company leave?"
 * The loop calls it once per company and nothing downstream re-asks: the
 * exporters keep their contract — hand them an array, they write every row of
 * it — so a filter cannot exist in two modules and start to disagree.
 *
 * One loop, not two phases
 * ------------------------
 * Profile, website and email happen together, per company, so the hipages
 * browser stays open for the whole run. The cost is one idle browser during
 * each email extraction, and it is small: `websiteVisitor.visitWebsite()`
 * already launches and closes its own browser per call, so nothing here holds a
 * second one open in parallel — the hipages page is simply parked between
 * profiles.
 *
 * Discovery is not sized to the request
 * -------------------------------------
 * There is no page budget to compute, because every company is wanted in both
 * modes. The collector is allowed to walk to its own ceiling (the directory API
 * stops at roughly 100 businesses per category + suburb and says so), which
 * costs ~10 JSON requests and no browser. Running out of that list is exactly
 * the `source-exhausted` ending.
 *
 * Failure isolation
 * -----------------
 * A company that fails is counted in `summary.failed` and, in both modes, is
 * not exported — never a thrown exception, never a half-built record. The
 * isolation itself is the company processor's, already implemented and tested;
 * this module surfaces it rather than repeating it.
 *
 * Deliberately out of scope: SQLite, CSV, the API, the frontend. The pipeline
 * returns records and a summary; who stores them is a later sprint's question.
 *
 * Usage
 * -----
 *   node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [all|with-email]
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { collectListingUrls } from '../scrapers/hipages/crawler.js';
import { processCompany } from './companyProcessor.service.js';
import { extractEmail } from './emailExtractor.service.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'scrapingPipeline' });

const VIEWPORT = { width: 1440, height: 900 };

/**
 * The two scraping modes.
 *
 * The values are what travels over HTTP, sits in the job's params, and reaches
 * `isExportable()`. They are declared here rather than in the descriptor
 * because this module is where they mean something; the descriptor imports
 * nothing, so it repeats the two strings as literals and this constant is what
 * they are checked against.
 *
 * @typedef {'all'|'with-email'} ScrapingMode
 */
export const SCRAPING_MODE = Object.freeze({
  /** Export every company that did not error, email or not. */
  ALL: 'all',
  /** Export only companies with a valid email. */
  WITH_EMAIL: 'with-email',
});

/** @typedef {'success'|'skipped'|'failed'} CompanyStatus */

/**
 * Why the run stopped. Both values are a *successful* run in the sense that
 * nothing broke; only the second is an interruption.
 *
 *   `source-exhausted` hipages ran out of companies — the ordinary ending
 *   `cancelled`        the caller aborted mid-run
 *
 * There is no `target-reached` any more. Nothing stops this loop early, so a
 * third value would be unreachable and would only invite callers to handle a
 * case that cannot occur.
 *
 * @typedef {'source-exhausted'|'cancelled'} StopReason
 */

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
 * Counters for one run.
 *
 * The four outcome buckets partition every company the loop touched:
 *
 *   processed = emailsFound + skipped + failed
 *
 * `exported` cuts across them instead of joining them — it is the count the
 * mode decides, and the only number in here that differs between the two modes:
 *
 *   all         exported = processed - failed
 *   with-email  exported = emailsFound
 *
 * @typedef {object} PipelineSummary
 * @property {number} discovered  Profile URLs the listing collector found. Every
 *   one of them is opened, so this is also the size of the run.
 * @property {number} processed   Companies opened and evaluated. Reaches
 *   `discovered` on a run that is not cancelled.
 * @property {number} exported    Companies that qualified under the run's mode
 *   and were handed to the exporters. The row count of both files.
 * @property {number} skipped     Companies that yielded no email — no website at
 *   all, or a website that publishes no address. One bucket, because the two are
 *   the same fact from the export's point of view. NOT the same as "not
 *   exported": in `all` mode these are rows, with an empty Email cell.
 * @property {number} failed      Companies that errored, including a company
 *   whose email extraction itself broke. Never exported, in either mode.
 * @property {number} emailsFound Companies with a valid email.
 */

/** Empty credentials, matching the parser's shape, for a company that failed. */
const NO_CREDENTIALS = Object.freeze({
  abn: null,
  licences: [],
  insurance: { hasPublicLiability: false, types: [] },
});

/**
 * Reads a requested mode, defaulting to "all".
 *
 * Anything that is not exactly `with-email` is `all`. That asymmetry is
 * deliberate: `all` is the documented default and the wider result, so an
 * unrecognised value degrades to exporting more rather than to silently
 * dropping companies the operator never asked to drop.
 *
 * @param {unknown} value
 * @returns {ScrapingMode}
 */
export function toScrapingMode(value) {
  return value === SCRAPING_MODE.WITH_EMAIL ? SCRAPING_MODE.WITH_EMAIL : SCRAPING_MODE.ALL;
}

/**
 * Decides whether an address counts — the single definition of "valid email".
 *
 * It is one line today because the validation already happened: the extractor's
 * `isUsableEmail()` rejects Sentry DSNs, asset filenames and placeholder
 * domains *before* returning, so a non-null address is an address that survived
 * those rules. Re-checking here would be a second, weaker opinion about the
 * same question.
 *
 * It exists as a named function anyway, because `isExportable()` and the
 * counters both ask it, and the day the rule gets stricter (role addresses, an
 * MX lookup) there must be exactly one place to change.
 *
 * @param {string|null|undefined} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return typeof email === 'string' && email.trim() !== '';
}

/**
 * THE export predicate. One company, one mode, one answer.
 *
 * Every filtering decision in the application resolves to this call. The loop
 * below asks it once per company; the CSV exporter, the Excel exporter and the
 * runner ask it never, because they receive an array that has already been
 * decided. That is what keeps "which rows are in the file?" a question with a
 * single implementation rather than three that agree until one of them changes.
 *
 * A failed company is excluded in BOTH modes. It is not a judgement about the
 * mode — a record of nulls with an error string is not a business listing, and
 * exporting one would put a row in the file that describes nothing.
 *
 * @param {CompanyRecord} record
 * @param {ScrapingMode} [mode]
 * @returns {boolean}
 */
export function isExportable(record, mode = SCRAPING_MODE.ALL) {
  if (!record) return false;
  if (toScrapingMode(mode) === SCRAPING_MODE.WITH_EMAIL) return isValidEmail(record.email);
  return record.status !== 'failed';
}

/**
 * Derives the outcome of one company.
 *
 * Three states, and the order matters: a company that errored is `failed` even
 * if it also had no website, because the error is the more informative fact. An
 * email extraction that *broke* counts the same way — the address is not absent
 * but unknowable, which is a failure of the run rather than a fact about the
 * business.
 *
 * `skipped` means "no website to read". A company whose website simply carries
 * no address is `success`: everything the run set out to do for it worked, and
 * the empty Email cell is the answer, not an error.
 *
 * @param {import('./companyProcessor.service.js').CompanyResult} result
 * @param {string|null} [emailError]
 * @returns {CompanyStatus}
 */
function toStatus(result, emailError = null) {
  if (result.error || emailError) return 'failed';
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
    status: toStatus(result, emailError),
    error: result.error ?? emailError,
  };
}

/**
 * Counts a set of records.
 *
 * A fallback, and a narrow one: `runPipeline()` counts as it goes and returns
 * the authoritative summary, because only the loop knows how many companies
 * were discovered and, in `with-email` mode, which ones it dropped. This
 * reports what records alone can support and nothing more. It is here for the
 * exporters' standalone CLI paths.
 *
 * @param {CompanyRecord[]} records
 * @param {number} discovered
 * @param {ScrapingMode} [mode]
 * @returns {PipelineSummary}
 */
export function summarise(records, discovered, mode = SCRAPING_MODE.ALL) {
  return {
    discovered,
    processed: records.length,
    exported: records.filter((record) => isExportable(record, mode)).length,
    skipped: records.filter((record) => !isValidEmail(record.email) && record.status !== 'failed')
      .length,
    failed: records.filter((record) => record.status === 'failed').length,
    emailsFound: records.filter((record) => isValidEmail(record.email)).length,
  };
}

/**
 * Runs the email extractor against a homepage the processor already captured.
 *
 * The capture is read from disk rather than re-visited — the whole reason the
 * visitor writes a file is so nobody opens that page twice. A company with no
 * capture answers "no email" rather than raising, so the caller has one code
 * path for "no website" and "website with no address": both are simply an empty
 * Email cell.
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
 *   profileUrls?: string[],
 *   mode?: ScrapingMode
 * }} params Either a category to collect from, or explicit profile URLs.
 *   `mode` decides which processed companies are returned — never how many are
 *   discovered, opened or checked, which is always all of them.
 * @param {{
 *   signal?: AbortSignal,
 *   delayMs?: number,
 *   onDiscovered?: (info: { profileUrls: string[], discovered: number }) => void,
 *   onProgress?: (summary: PipelineSummary, record: CompanyRecord, info: { exported: boolean }) => void
 * }} [options] `onProgress` fires once per company processed, carrying a
 *   snapshot of the counters, that company's finished record, and whether the
 *   record qualified for export under the run's mode. It fires identically in
 *   both modes — the counters are the run, and the mode is only what leaves at
 *   the end. The pipeline counts; nobody downstream should keep a second tally.
 * @returns {Promise<{
 *   records: CompanyRecord[],
 *   summary: PipelineSummary,
 *   stopReason: StopReason
 * }>} `records` contains exactly the companies `isExportable()` accepted.
 */
export async function runPipeline(params = {}, options = {}) {
  const mode = toScrapingMode(params.mode);
  const delayMs = options.delayMs ?? config.scraper.requestDelayMs;

  /** Only the exportable ones. Everything else is counted, then let go. */
  /** @type {CompanyRecord[]} */
  const records = [];

  /** @type {PipelineSummary} */
  const summary = {
    discovered: 0,
    processed: 0,
    exported: 0,
    skipped: 0,
    failed: 0,
    emailsFound: 0,
  };

  /**
   * Running out of companies is the only ending that is not an interruption.
   * Starting here means the only way to report anything else is for the run to
   * actually be aborted.
   *
   * @type {StopReason}
   */
  let stopReason = 'source-exhausted';

  const browser = await chromium.launch({ headless: config.scraper.headless });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: config.scraper.userAgent,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.scraper.navigationTimeoutMs);

    let profileUrls = params.profileUrls ?? [];

    if (profileUrls.length === 0) {
      // No `maxPages`, in either mode. Both are asking for the whole source, so
      // the collector keeps requesting the directory's "View More" pages until
      // it is empty or the API's own offset ceiling is reached, and reports
      // which one ended it.
      const collected = await collectListingUrls(
        page,
        {
          listingUrl: params.categoryUrl,
          category: params.category,
          location: params.location,
        },
        { signal: options.signal },
      );
      profileUrls = collected.profileUrls;
      log.info('Discovered companies', {
        mode,
        discovered: profileUrls.length,
        pagesVisited: collected.pagesVisited,
        terminationReason: collected.terminationReason,
      });
    }

    summary.discovered = profileUrls.length;
    // Nothing is sliced off either end: every discovered company is opened, and
    // the mode has no say in that.
    options.onDiscovered?.({ profileUrls, discovered: summary.discovered });

    for (const [position, profileUrl] of profileUrls.entries()) {
      if (options.signal?.aborted) {
        stopReason = 'cancelled';
        log.warn('Pipeline aborted', { checked: summary.processed, exported: summary.exported });
        break;
      }

      // Politeness delay between companies — never before the first one.
      if (position > 0 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const result = await processCompany(page, profileUrl, position + 1, {
        signal: options.signal,
      });
      summary.processed += 1;

      // A company that failed has no homepage capture to read, so there is
      // nothing to extract from and nothing to report about the attempt.
      // Otherwise `extractEmailFor()` answers for every case, including the
      // company that has no website at all.
      const { email, error: emailError } = result.error
        ? { email: { email: null }, error: null }
        : await extractEmailFor(result);

      // Built for EVERY company now, not only the ones that qualify. The record
      // is what the predicate reads, so it has to exist before the mode is
      // consulted — and it is the same record either mode would export.
      const record = buildCompanyRecord(result, email, emailError);

      // The three outcome buckets, derived from the finished record rather than
      // from the branch that produced it. `processed` is their sum, always.
      if (record.status === 'failed') summary.failed += 1;
      else if (isValidEmail(record.email)) summary.emailsFound += 1;
      else summary.skipped += 1;

      // ── The only line in the run that differs between the two modes ────────
      const exported = isExportable(record, mode);
      if (exported) {
        records.push(record);
        summary.exported += 1;
      }

      options.onProgress?.({ ...summary }, record, { exported });
    }

    // An abort that lands during the last company would otherwise leave the
    // loop by its normal exit and report the wrong ending.
    if (options.signal?.aborted) stopReason = 'cancelled';
  } finally {
    await browser.close();
    log.info('hipages browser closed');
  }

  log.info('Pipeline finished', { mode, stopReason, ...summary });

  return { records, summary, stopReason };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [categoryUrl, rawMode] = process.argv.slice(2);

  if (!categoryUrl) {
    process.stderr.write(
      'Usage: node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [all|with-email]\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const { records, summary, stopReason } = await runPipeline({
      categoryUrl,
      mode: toScrapingMode(rawMode),
    });
    process.stdout.write(`${JSON.stringify({ stopReason, summary, records }, null, 2)}\n`);
  } catch (error) {
    log.error('Pipeline failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export const scrapingPipeline = {
  runPipeline,
  buildCompanyRecord,
  summarise,
  isValidEmail,
  isExportable,
  toScrapingMode,
  SCRAPING_MODE,
};

export default scrapingPipeline;
