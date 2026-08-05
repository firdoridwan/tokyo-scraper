/**
 * Email extractor — CLI test script.
 *
 * Prints, for every company it processes:
 *
 *   Company / Website / Email / Found On / Source Page
 *
 * Four ways in, cheapest first — the extractor is the same in all of them, only
 * the source of the homepage HTML changes:
 *
 *   --html <path> --url <url>   a capture already on disk           no network
 *   --website <url>             one website, visited now            1 browser
 *   --urls <profileUrl,…>       named hipages profiles              full chain
 *   [categoryUrl] [limit]       collect from a category, then run   full chain
 *
 * The `--html` mode matters most for regression testing: `data/websites/`
 * already holds real captures, so verifying the extractor normally costs a file
 * read. Only the follow-up to an internal contact page opens a browser, and
 * only when the homepage had no address.
 *
 * Usage
 * -----
 *   node backend/src/services/emailExtractor.test.js --html data/websites/<dir>/website.html --url https://example.com/
 *   node backend/src/services/emailExtractor.test.js --website https://example.com
 *   node backend/src/services/emailExtractor.test.js --urls https://hipages.com.au/connect/<a>,https://hipages.com.au/connect/<b>
 *   node backend/src/services/emailExtractor.test.js https://hipages.com.au/find/electricians/nsw/sydney 3
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { collectListingUrls } from '../scrapers/hipages/crawler.js';
import { processCompanies } from './companyProcessor.service.js';
import { visitWebsite } from './websiteVisitor.service.js';
import { extractEmail } from './emailExtractor.service.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const VIEWPORT = { width: 1440, height: 900 };

/** @param {string|null|undefined} value */
const show = (value) => value ?? '—';

/**
 * The five requested lines, plus the reason when there is nothing to extract.
 *
 * @param {{ company: string|null, website: string|null, email: import('./emailExtractor.service.js').EmailResult|null, note: string|null }} row
 * @param {number} index
 * @param {number} total
 */
function printRow(row, index, total) {
  process.stdout.write(`\nCompany ${index} / ${total}\n\n`);
  process.stdout.write(`Company:      ${show(row.company)}\n`);
  process.stdout.write(`Website:      ${show(row.website)}\n`);
  process.stdout.write(`Email:        ${show(row.email?.email)}\n`);
  process.stdout.write(`Found On:     ${show(row.email?.foundOn)}\n`);
  process.stdout.write(`Source Page:  ${show(row.email?.sourcePage)}\n`);
  if (row.note) process.stdout.write(`Note:         ${row.note}\n`);
}

/**
 * @param {{ company: string|null, website: string|null, email: object|null }[]} rows
 */
function printSummary(rows) {
  const withEmail = rows.filter((row) => row.email?.email);
  process.stdout.write('\n\nSummary\n\n');
  process.stdout.write(`Companies:        ${rows.length}\n`);
  process.stdout.write(`Emails found:     ${withEmail.length}\n`);
  process.stdout.write(`No email:         ${rows.length - withEmail.length}\n`);

  const byFoundOn = new Map();
  for (const row of withEmail) {
    byFoundOn.set(row.email.foundOn, (byFoundOn.get(row.email.foundOn) ?? 0) + 1);
  }
  for (const [foundOn, count] of byFoundOn) {
    process.stdout.write(`  via ${foundOn}:${' '.repeat(Math.max(1, 12 - foundOn.length))}${count}\n`);
  }
  process.stdout.write('\n');
}

/**
 * Reads a capture off disk and extracts from it. No hipages, no homepage visit.
 *
 * @param {{ htmlPath: string, pageUrl: string }} input
 */
async function runFromFile(input) {
  const html = await fs.readFile(input.htmlPath, 'utf8');
  const email = await extractEmail({ html, pageUrl: input.pageUrl });
  const row = { company: null, website: input.pageUrl, email, note: null };
  printRow(row, 1, 1);
  printSummary([row]);
}

/**
 * Visits one website now, then extracts. The company name is unknown in this
 * mode — it comes from the hipages profile, which was never opened.
 *
 * @param {{ websiteUrl: string }} input
 */
async function runFromWebsite(input) {
  const capture = await visitWebsite(input.websiteUrl);
  const html = await fs.readFile(capture.htmlPath, 'utf8');
  const email = await extractEmail({ html, pageUrl: capture.finalUrl ?? input.websiteUrl });
  const row = { company: null, website: input.websiteUrl, email, note: null };
  printRow(row, 1, 1);
  printSummary([row]);
}

/**
 * The full chain: hipages profiles → homepage captures → email extraction.
 *
 * The homepage is captured once, by the company processor, and this script
 * reads that same file back. Nothing re-visits a homepage to look for an email.
 *
 * @param {{ categoryUrl?: string, urls?: string[], limit?: number }} input
 */
async function runFromProfiles(input) {
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
      process.stdout.write(`Collected ${profileUrls.length} company URL(s)\n`);
    }

    if (input.limit) profileUrls = profileUrls.slice(0, input.limit);

    if (profileUrls.length === 0) {
      process.stdout.write('\nNo company URLs to process.\n');
      return;
    }

    const { results } = await processCompanies(page, profileUrls);

    const rows = [];
    for (const [position, result] of results.entries()) {
      const row = {
        company: result.companyName,
        website: result.website,
        email: null,
        note: null,
      };

      if (result.error) row.note = `company failed: ${result.error}`;
      else if (!result.websiteFound) row.note = 'no website listed on the profile';
      else if (!result.htmlPath) row.note = 'homepage was not captured';
      else {
        const html = await fs.readFile(result.htmlPath, 'utf8');
        row.email = await extractEmail({
          html,
          pageUrl: result.finalUrl ?? result.websiteUrl,
        });
      }

      rows.push(row);
      printRow(row, position + 1, results.length);
    }

    printSummary(rows);
  } finally {
    await browser.close();
  }
}

/**
 * @param {string[]} args
 * @param {string} flag
 * @returns {string|undefined}
 */
function flagValue(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const args = process.argv.slice(2);

  try {
    const htmlPath = flagValue(args, '--html');
    if (htmlPath) {
      const pageUrl = flagValue(args, '--url');
      if (!pageUrl) throw new Error('--html also requires --url <pageUrl>.');
      await runFromFile({ htmlPath, pageUrl });
      return;
    }

    const websiteUrl = flagValue(args, '--website');
    if (websiteUrl) {
      await runFromWebsite({ websiteUrl });
      return;
    }

    if (args[0] === '--urls') {
      const urls = (args[1] ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      if (urls.length === 0) throw new Error('--urls requires at least one URL.');
      await runFromProfiles({ urls });
      return;
    }

    const categoryUrl = args[0] ?? DEFAULT_CATEGORY_URL;
    const limit = args[1] ? Number.parseInt(args[1], 10) : undefined;
    if (args[1] && !Number.isInteger(limit)) {
      throw new Error(`limit must be an integer, received "${args[1]}".`);
    }
    await runFromProfiles({ categoryUrl, limit });
  } catch (error) {
    process.stderr.write(`\nEmail extraction failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default main;
