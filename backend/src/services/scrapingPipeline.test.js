/**
 * Scraping pipeline — CLI test script.
 *
 * Runs the whole chain end to end and prints one block per company, then the
 * final counts.
 *
 * Usage
 * -----
 *   node backend/src/services/scrapingPipeline.test.js [categoryUrl] [targetEmails]
 *   node backend/src/services/scrapingPipeline.test.js --urls <profileUrl>[,<profileUrl>...]
 *   node backend/src/services/scrapingPipeline.test.js <categoryUrl> <targetEmails> --json
 *
 * `targetEmails` is how many valid addresses to collect before stopping — the
 * run checks as many companies as that takes, or every company hipages has,
 * whichever comes first. Omit it and the run only stops at the end of the
 * source, which is a long one. `--json` additionally dumps the complete record
 * objects, which is how the full field set (reviews, gallery, credentials …)
 * gets eyeballed.
 */
import { pathToFileURL } from 'node:url';
import { runPipeline } from './scrapingPipeline.service.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const RULE = '-'.repeat(40);

/** @param {string|null|undefined} value */
const show = (value) => value ?? '—';

/**
 * @param {import('./scrapingPipeline.service.js').CompanyRecord} record
 * @param {import('./scrapingPipeline.service.js').PipelineSummary} summary
 */
function printCompany(record, summary) {
  process.stdout.write(`\n${RULE}\n\n`);
  process.stdout.write(`Email ${summary.emailsFound} (company ${summary.processed} checked)\n\n`);
  process.stdout.write(`Company: ${show(record.companyName)}\n\n`);
  process.stdout.write(`Website: ${show(record.website)}\n\n`);
  process.stdout.write(`Email: ${show(record.email)}\n\n`);
  process.stdout.write(`Status: ${record.status.toUpperCase()}\n\n`);
  if (record.error) process.stdout.write(`Error: ${record.error}\n\n`);
  process.stdout.write(`${RULE}\n`);
}

/**
 * @param {import('./scrapingPipeline.service.js').PipelineSummary} summary
 * @param {import('./scrapingPipeline.service.js').StopReason} stopReason
 */
function printSummary(summary, stopReason) {
  process.stdout.write('\nFinal Summary\n\n');
  process.stdout.write(`Stopped because:      ${stopReason}\n`);
  process.stdout.write(`Companies available:  ${summary.discovered}\n`);
  process.stdout.write(`Companies checked:    ${summary.processed}\n`);
  process.stdout.write(`Companies skipped:    ${summary.skipped}\n`);
  process.stdout.write(`Companies failed:     ${summary.failed}\n`);
  process.stdout.write(`Emails found:         ${summary.emailsFound}\n\n`);
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const positional = args.filter((arg) => arg !== '--json');

  try {
    /** @type {{ categoryUrl?: string, profileUrls?: string[], limit?: number }} */
    let params;

    if (positional[0] === '--urls') {
      const profileUrls = (positional[1] ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      if (profileUrls.length === 0) throw new Error('--urls requires at least one URL.');
      params = { profileUrls };
    } else {
      const categoryUrl = positional[0] ?? DEFAULT_CATEGORY_URL;
      const limit = positional[1] ? Number.parseInt(positional[1], 10) : undefined;
      if (positional[1] && !Number.isInteger(limit)) {
        throw new Error(`limit must be an integer, received "${positional[1]}".`);
      }
      params = { categoryUrl, limit };
    }

    const startedAt = Date.now();
    const { records, summary, stopReason } = await runPipeline(params, {
      onDiscovered: ({ discovered }) =>
        process.stdout.write(`\nDiscovered ${discovered} company URL(s) to draw from\n`),
      // Only companies that qualified print a block. The dropped ones are in
      // the counters — printing one block per skip would bury the hits.
      onProgress: (snapshot, record) => {
        if (record) printCompany(record, snapshot);
      },
    });
    const elapsedMs = Date.now() - startedAt;

    printSummary(summary, stopReason);
    process.stdout.write(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s\n\n`);

    if (asJson) process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`\nPipeline failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default main;
