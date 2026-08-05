/**
 * hipages — listing collector test script.
 *
 * Walks a hipages category through the directory API and prints what was
 * collected: pages requested, total company profile URLs, and the first ten.
 *
 * It still creates the browser and injects the page, which is now a test in
 * itself: collection no longer needs a browser, and this proves the collector
 * still accepts the context every other caller passes it.
 *
 * It collects URLs and stops. No profile is opened, no company data is parsed,
 * nothing is written to a database or a CSV.
 *
 * Usage
 * -----
 *   node backend/src/scrapers/hipages/crawler.test.js ["<categoryUrl>"] [maxPages]
 *
 * Defaults to the electricians/Sydney category when no URL is given.
 */
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../../config/env.js';
import { collectListingUrls } from './crawler.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const VIEWPORT = { width: 1440, height: 900 };
const PREVIEW_COUNT = 10;

/** Plain-English gloss on why the walk stopped. */
const TERMINATION_NOTES = {
  'no-more-results': 'the directory API returned an empty page',
  'max-pages': 'collected the maxPages × 10 companies the caller asked for',
  'page-ceiling': 'the next offset would exceed the API’s maximum of 90',
  aborted: 'cancelled via AbortSignal',
};

/**
 * @param {string} categoryUrl
 * @param {number|undefined} maxPages
 */
async function run(categoryUrl, maxPages) {
  const browser = await chromium.launch({ headless: config.scraper.headless });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: config.scraper.userAgent,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.scraper.navigationTimeoutMs);

    const startedAt = Date.now();
    const result = await collectListingUrls(page, {
      listingUrl: categoryUrl,
      ...(maxPages ? { maxPages } : {}),
    });
    const elapsedMs = Date.now() - startedAt;

    process.stdout.write('\n── Listing collection ──────────────────────────────────────\n');
    process.stdout.write(`Category URL         ${categoryUrl}\n`);
    process.stdout.write(`Total pages visited  ${result.pagesVisited}\n`);
    process.stdout.write(`Total company URLs   ${result.profileUrls.length}\n`);
    process.stdout.write(`Duplicates removed   ${result.duplicatesRemoved}\n`);
    process.stdout.write(
      `Stopped because      ${result.terminationReason}` +
        ` — ${TERMINATION_NOTES[result.terminationReason] ?? 'unknown'}\n`,
    );
    process.stdout.write(`Elapsed              ${(elapsedMs / 1000).toFixed(1)}s\n`);

    process.stdout.write('\nPages visited:\n');
    result.pageUrls.forEach((url, index) => {
      process.stdout.write(`  ${String(index + 1).padStart(2)}. ${url}\n`);
    });

    process.stdout.write(`\nFirst ${PREVIEW_COUNT} company URLs:\n`);
    const preview = result.profileUrls.slice(0, PREVIEW_COUNT);
    if (preview.length === 0) {
      process.stdout.write('  (none found)\n');
    } else {
      preview.forEach((url, index) => {
        process.stdout.write(`  ${String(index + 1).padStart(2)}. ${url}\n`);
      });
    }
    if (result.profileUrls.length > PREVIEW_COUNT) {
      process.stdout.write(`  … and ${result.profileUrls.length - PREVIEW_COUNT} more\n`);
    }
    process.stdout.write('\n');
  } finally {
    await browser.close();
  }
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [urlArg, maxPagesArg] = process.argv.slice(2);
  const categoryUrl = urlArg ?? DEFAULT_CATEGORY_URL;
  const maxPages = maxPagesArg ? Number.parseInt(maxPagesArg, 10) : undefined;

  if (maxPagesArg !== undefined && !Number.isInteger(maxPages)) {
    process.stderr.write(`maxPages must be an integer, received "${maxPagesArg}".\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await run(categoryUrl, maxPages);
  } catch (error) {
    process.stderr.write(`\nListing collection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default run;
