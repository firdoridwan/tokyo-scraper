/**
 * Company processor — CLI test script.
 *
 * Chains the two previous sprints end to end: the listing collector produces
 * profile URLs, the company processor walks them, and each company that lists a
 * website has its homepage captured.
 *
 * Usage
 * -----
 *   node backend/src/services/companyProcessor.test.js [categoryUrl] [limit]
 *   node backend/src/services/companyProcessor.test.js --urls <url>[,<url>...]
 *
 * `limit` caps how many collected companies are processed — useful because a
 * full run opens a browser per company website. Defaults to all of them.
 */
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { collectListingUrls } from '../scrapers/hipages/crawler.js';
import { processCompanies } from './companyProcessor.service.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const VIEWPORT = { width: 1440, height: 900 };

/** @param {string|null} value */
const show = (value) => value ?? '—';

/**
 * Prints one company block in the requested format.
 *
 * @param {import('./companyProcessor.service.js').CompanyResult} result
 * @param {number} total
 */
function printCompany(result, total) {
  process.stdout.write(`\nProcessing company ${result.index} / ${total}\n\n`);
  process.stdout.write(`Company:        ${show(result.companyName)}\n`);
  process.stdout.write(`Website:        ${show(result.website)}\n`);
  process.stdout.write(`Website Found:  ${result.websiteFound ? 'yes' : 'no'}\n`);
  process.stdout.write(`HTML Saved:     ${show(result.htmlPath)}\n`);

  if (result.error) process.stdout.write(`Error:          ${result.error}\n`);
  else if (result.skippedReason === 'no-website') {
    process.stdout.write('Skipped:        no website listed on the profile\n');
  }
}

/**
 * @param {{ categoryUrl?: string, urls?: string[], limit?: number }} input
 */
async function run(input) {
  const browser = await chromium.launch({ headless: config.scraper.headless });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: config.scraper.userAgent,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.scraper.navigationTimeoutMs);

    let profileUrls = input.urls ?? [];

    if (profileUrls.length === 0) {
      process.stdout.write(`Collecting listings from ${input.categoryUrl}\n`);
      const collected = await collectListingUrls(page, { listingUrl: input.categoryUrl });
      profileUrls = collected.profileUrls;
      process.stdout.write(
        `Collected ${profileUrls.length} company URL(s) across ` +
          `${collected.pagesVisited} page(s) — stopped: ${collected.terminationReason}\n`,
      );
    }

    if (input.limit) profileUrls = profileUrls.slice(0, input.limit);

    if (profileUrls.length === 0) {
      process.stdout.write('\nNo company URLs to process.\n');
      return;
    }

    const startedAt = Date.now();
    const { summary } = await processCompanies(page, profileUrls, {
      onProgress: printCompany,
    });
    const elapsedMs = Date.now() - startedAt;

    process.stdout.write('\n\nSummary\n\n');
    process.stdout.write(`Companies processed:  ${summary.processed}\n`);
    process.stdout.write(`Companies skipped:    ${summary.skipped}\n`);
    process.stdout.write(`Companies visited:    ${summary.visited}\n`);
    process.stdout.write(`Companies failed:     ${summary.failed}\n`);
    process.stdout.write(`Elapsed:              ${(elapsedMs / 1000).toFixed(1)}s\n\n`);
  } finally {
    await browser.close();
  }
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const args = process.argv.slice(2);

  try {
    if (args[0] === '--urls') {
      const urls = (args[1] ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      if (urls.length === 0) throw new Error('--urls requires at least one URL.');
      await run({ urls });
      return;
    }

    const categoryUrl = args[0] ?? DEFAULT_CATEGORY_URL;
    const limit = args[1] ? Number.parseInt(args[1], 10) : undefined;
    if (args[1] && !Number.isInteger(limit)) {
      throw new Error(`limit must be an integer, received "${args[1]}".`);
    }
    await run({ categoryUrl, limit });
  } catch (error) {
    process.stderr.write(`\nCompany processing failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default run;
