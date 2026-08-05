/**
 * Scraping pipeline.
 *
 * The one place where the finished pieces are wired together:
 *
 *   category URL
 *     → crawler.collectListingUrls()   profile URLs                 (listing collector)
 *     → for each company, until the email target is met:
 *         ├ companyProcessor.processCompany()                        (profile → parse → visit)
 *         │   ├ crawler.fetchProfilePage() + parser.parseProfilePage()
 *         │   └ websiteVisitor.visitWebsite()   only when a website exists
 *         └ emailExtractor.extractEmail()  one address per company   (email extractor)
 *     → one record per company THAT HAS A VALID EMAIL
 *
 * It owns no scraping logic. Everything here is sequencing, one derived field
 * (`status`), the record shape, and the two decisions below. If a behaviour
 * looks like it belongs to a step — how a listing is paginated, when a website
 * counts as present, how far an email search may crawl — it lives in that
 * step's module and is not re-decided here.
 *
 * What the run is for
 * -------------------
 * The goal is a number of EMAILS, not a number of companies. `limit` is the
 * email target: the loop keeps checking companies until it has collected that
 * many valid addresses, or until hipages runs out of companies — whichever
 * happens first. BOTH endings are a successful run, and `stopReason` says which
 * one it was so the caller can word the outcome without guessing.
 *
 * A company with no website, or with a website that publishes no address, is
 * checked, counted, and dropped. It never becomes a record, so it can never
 * reach an export. That is the whole of the filtering rule, and it lives here
 * rather than in an exporter for two reasons: the stop condition and the export
 * filter are the same question ("does this company have a valid email?"), and
 * asking it twice in two modules is how the two answers start to disagree. The
 * exporters keep their contract — hand them an array, they write every row of
 * it — and are untouched by this requirement.
 *
 * One loop, not two phases
 * ------------------------
 * This module used to collect and process every company first, then extract
 * every email afterwards, so the hipages browser could close before the email
 * step began. That split cannot survive a target measured in emails: the email
 * is only known in the second phase, and a counter cannot stop a loop that has
 * already run to the end. So profile, website and email now happen together,
 * per company, and the browser stays open for the whole run.
 *
 * The cost is one idle browser during each email extraction. It is small:
 * `websiteVisitor.visitWebsite()` already launches and closes its own browser
 * per call, so nothing here is holding a second one open in parallel — the
 * hipages page is simply parked between profiles.
 *
 * Discovery is no longer sized to the request
 * -------------------------------------------
 * How many companies it takes to find N emails is not knowable in advance, so
 * there is no page budget to compute. The collector is allowed to walk to its
 * own ceiling (the directory API stops at roughly 100 businesses per category +
 * suburb and says so), which costs ~10 JSON requests and no browser. Running
 * out of that list is exactly the `source-exhausted` ending.
 *
 * Failure isolation
 * -----------------
 * A company that fails is counted in `summary.failed` and dropped — never a
 * thrown exception, never a half-built record. The isolation itself is the
 * company processor's, already implemented and tested; this module surfaces it
 * rather than repeating it.
 *
 * Deliberately out of scope: SQLite, CSV, the API, the frontend. The pipeline
 * returns records and a summary; who stores them is a later sprint's question.
 *
 * Usage
 * -----
 *   node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [targetEmails]
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

/** @typedef {'success'|'skipped'|'failed'} CompanyStatus */

/**
 * Why the run stopped. Every value below is a *successful* run — the two that
 * are not cancellations differ only in whether the target was met.
 *
 *   `target-reached`   enough emails were collected
 *   `source-exhausted` hipages ran out of companies first
 *   `cancelled`        the caller aborted mid-run
 *
 * @typedef {'target-reached'|'source-exhausted'|'cancelled'} StopReason
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
 * The field names are unchanged from when the run counted companies, and that
 * is deliberate: they are what the workbook's Summary sheet is built from, and
 * that sheet's format must not move. What each one *counts* has shifted with
 * the requirement, so read them as written here rather than by their old
 * meaning.
 *
 * The four outcome buckets partition every company the loop touched:
 *
 *   processed = emailsFound + skipped + failed
 *
 * @typedef {object} PipelineSummary
 * @property {number} discovered  Profile URLs the listing collector found. An
 *   upper bound on the run, not a plan for it — the loop usually stops earlier.
 * @property {number} processed   Companies checked, i.e. actually opened and
 *   evaluated. Whatever the target, this is the work that was done.
 * @property {number} skipped     Companies dropped for having no website OR no
 *   email on the website they do have. One bucket, because the export treats
 *   them identically: neither yields an address, so neither is a row.
 * @property {number} failed      Companies that errored, including a company
 *   whose email extraction itself broke
 * @property {number} emailsFound Companies with a valid email. This is the goal
 *   of the run, the length of `records`, and the number of rows exported.
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
 * In practice only `success` now reaches a record — `runPipeline()` drops
 * skipped and failed companies before one is built, so the Status column of an
 * export reads `success` throughout. The other two branches are kept because
 * this function derives a status from a result, and a caller holding a failed
 * result is entitled to a truthful answer rather than a wrong one.
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
 * Decides whether a company qualifies — the single definition of "valid email".
 *
 * It is one line today because the validation already happened: the extractor's
 * `isUsableEmail()` rejects Sentry DSNs, asset filenames and placeholder
 * domains *before* returning, so a non-null address is an address that survived
 * those rules. Re-checking here would be a second, weaker opinion about the
 * same question.
 *
 * It exists as a named function anyway, because both the stop condition and the
 * export filter ask it, and the day the rule gets stricter (role addresses, an
 * MX lookup) there must be exactly one place to change.
 *
 * @param {string|null|undefined} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  return typeof email === 'string' && email.trim() !== '';
}

/**
 * Reads the email target off the requested `limit`.
 *
 * The parameter kept its name — it is still the ceiling the operator sets —
 * but it now counts emails rather than companies. Anything unusable (absent,
 * zero, negative, not a number) means "no target", and a run with no target
 * ends only when the source is exhausted.
 *
 * @param {unknown} limit
 * @returns {number|null}
 */
export function toEmailTarget(limit) {
  const requested = Number(limit);
  if (!Number.isFinite(requested) || requested <= 0) return null;
  return Math.floor(requested);
}

/**
 * Counts a set of records.
 *
 * A fallback, and a narrow one: `runPipeline()` counts as it goes and returns
 * the authoritative summary, because only the loop sees the companies it
 * dropped. Records alone cannot report attrition — every record it is handed
 * qualified, or it would not exist — so this reports what records can support
 * and nothing more. It is here for the exporters' standalone CLI paths.
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
    emailsFound: records.filter((record) => isValidEmail(record.email)).length,
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
 *   profileUrls?: string[],
 *   limit?: number
 * }} params Either a category to collect from, or explicit profile URLs.
 *   `limit` is the EMAIL target — how many valid addresses to collect before
 *   stopping — not a company count and not a page budget. Omit it to run until
 *   the source is exhausted.
 * @param {{
 *   signal?: AbortSignal,
 *   delayMs?: number,
 *   onDiscovered?: (info: { profileUrls: string[], discovered: number }) => void,
 *   onProgress?: (summary: PipelineSummary, record: CompanyRecord|null) => void
 * }} [options] `onProgress` fires once per company checked, qualified or not,
 *   carrying a snapshot of the counters. `record` is the finished record when
 *   the company qualified and `null` when it was dropped — so a caller can
 *   report both movement and outcomes without counting anything itself. The
 *   pipeline counts; nobody downstream should keep a second tally.
 * @returns {Promise<{
 *   records: CompanyRecord[],
 *   summary: PipelineSummary,
 *   stopReason: StopReason
 * }>} `records` contains ONLY companies with a valid email.
 */
export async function runPipeline(params = {}, options = {}) {
  const target = toEmailTarget(params.limit);
  const delayMs = options.delayMs ?? config.scraper.requestDelayMs;

  /** @type {CompanyRecord[]} */
  const records = [];

  /** @type {PipelineSummary} */
  const summary = { discovered: 0, processed: 0, skipped: 0, failed: 0, emailsFound: 0 };

  /**
   * Running out of companies is the default ending, not an exceptional one.
   * Starting here means the only way to report anything else is to actually
   * reach that branch.
   *
   * @type {StopReason}
   */
  let stopReason = 'source-exhausted';

  /**
   * Reports one checked company. Called on every path out of the loop body, so
   * a caller's counters cannot silently miss a drop.
   *
   * @param {CompanyRecord|null} record
   */
  const publish = (record) => options.onProgress?.({ ...summary }, record ?? null);

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
      // No `maxPages`. How many companies it takes to find the target number of
      // emails is unknowable here, so the collector is left to walk to its own
      // documented ceiling and report why it stopped.
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
        target,
        discovered: profileUrls.length,
        pagesVisited: collected.pagesVisited,
        terminationReason: collected.terminationReason,
      });
    }

    summary.discovered = profileUrls.length;
    // Nothing is sliced off the front any more: this list is the pool to draw
    // from, and how much of it gets used depends on how many of these companies
    // turn out to publish an address.
    options.onDiscovered?.({ profileUrls, discovered: summary.discovered });

    for (const [position, profileUrl] of profileUrls.entries()) {
      if (options.signal?.aborted) {
        stopReason = 'cancelled';
        log.warn('Pipeline aborted', { checked: summary.processed, found: summary.emailsFound });
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

      // ── The four outcomes, in the order they can be decided ───────────────

      // 1. The company itself failed, so its email is not merely absent but
      //    unknowable. Recorded as a failure rather than a skip, matching the
      //    precedence `toStatus()` has always used.
      if (result.error) {
        summary.failed += 1;
        publish(null);
        continue;
      }

      // 2. No website means nothing to read an address from. This is the same
      //    condition `extractEmailFor()` guards on, stated once here so the
      //    company is counted rather than silently yielding a null email.
      if (!result.websiteVisited || !result.htmlPath) {
        summary.skipped += 1;
        publish(null);
        continue;
      }

      const { email, error } = await extractEmailFor(result);

      // 3. The extraction broke — a read error, not a site without an address.
      if (error) {
        summary.failed += 1;
        publish(null);
        continue;
      }

      // 4. The site simply publishes no address. The company's hipages data is
      //    perfectly good and still gets dropped: an export row without an
      //    email is exactly what this run is no longer for.
      if (!isValidEmail(email.email)) {
        summary.skipped += 1;
        publish(null);
        continue;
      }

      const record = buildCompanyRecord(result, email);
      records.push(record);
      summary.emailsFound += 1;
      publish(record);

      if (target !== null && records.length >= target) {
        stopReason = 'target-reached';
        break;
      }
    }
  } finally {
    await browser.close();
    log.info('hipages browser closed');
  }

  log.info('Pipeline finished', { stopReason, ...summary });

  return { records, summary, stopReason };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [categoryUrl, rawLimit] = process.argv.slice(2);

  if (!categoryUrl) {
    process.stderr.write(
      'Usage: node backend/src/services/scrapingPipeline.service.js "<categoryUrl>" [targetEmails]\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    const { records, summary, stopReason } = await runPipeline({ categoryUrl, limit });
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
  toEmailTarget,
};

export default scrapingPipeline;
