/**
 * Scraping pipeline — CLI test script.
 *
 * Runs the whole chain end to end and prints one block per company, then the
 * final counts.
 *
 * Usage
 * -----
 *   node backend/src/services/scrapingPipeline.test.js [categoryUrl] [all|with-email]
 *   node backend/src/services/scrapingPipeline.test.js --urls <profileUrl>[,<profileUrl>...] [mode]
 *   node backend/src/services/scrapingPipeline.test.js <categoryUrl> <mode> --json
 *
 * The mode decides which companies are EXPORTED, never which are checked — both
 * modes open every company hipages lists and the run always ends at the end of
 * the source, so a `with-email` run takes exactly as long as an `all` run over
 * the same category. Omit it and the run defaults to `all`.
 *
 * Every checked company prints a block, tagged EXPORTED or DROPPED, which is
 * what makes the two modes comparable by eye: the same companies appear in the
 * same order under both, and only the tags differ.
 *
 * `--json` additionally dumps the exported record objects, which is how the
 * full field set (reviews, gallery, credentials …) gets eyeballed.
 */
import { pathToFileURL } from 'node:url';
import { runPipeline, toScrapingMode, SCRAPING_MODE } from './scrapingPipeline.service.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const RULE = '-'.repeat(40);

/** @param {string|null|undefined} value */
const show = (value) => value ?? '—';

/**
 * @param {import('./scrapingPipeline.service.js').CompanyRecord} record
 * @param {import('./scrapingPipeline.service.js').PipelineSummary} summary
 * @param {boolean} exported
 */
function printCompany(record, summary, exported) {
  process.stdout.write(`\n${RULE}\n\n`);
  process.stdout.write(
    `Company ${summary.processed} of ${summary.discovered} — ` +
      `${exported ? 'EXPORTED' : 'DROPPED'}\n\n`,
  );
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
 * @param {import('./scrapingPipeline.service.js').ScrapingMode} mode
 * @param {number} exportedRecords Length of the returned array
 */
function printSummary(summary, stopReason, mode, exportedRecords) {
  // The invariant each mode is supposed to satisfy, printed beside the numbers
  // so a run either demonstrates it or visibly does not.
  const expected =
    mode === SCRAPING_MODE.WITH_EMAIL
      ? summary.emailsFound
      : summary.processed - summary.failed;

  process.stdout.write('\nFinal Summary\n\n');
  process.stdout.write(`Scraping mode:        ${mode}\n`);
  process.stdout.write(`Stopped because:      ${stopReason}\n`);
  process.stdout.write(`Companies discovered: ${summary.discovered}\n`);
  process.stdout.write(`Companies processed:  ${summary.processed}\n`);
  process.stdout.write(`Companies exported:   ${summary.exported}\n`);
  process.stdout.write(`Emails found:         ${summary.emailsFound}\n`);
  process.stdout.write(`Failed:               ${summary.failed}\n\n`);
  process.stdout.write(`Records returned:     ${exportedRecords}\n`);
  process.stdout.write(
    `Expected exported:    ${expected} ` + `${expected === summary.exported ? '✓' : '✗ MISMATCH'}\n`,
  );
  process.stdout.write(
    `Records match count:  ${exportedRecords === summary.exported ? '✓' : '✗ MISMATCH'}\n\n`,
  );
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const positional = args.filter((arg) => arg !== '--json');

  try {
    /** @type {{ categoryUrl?: string, profileUrls?: string[], mode: string }} */
    let params;

    if (positional[0] === '--urls') {
      const profileUrls = (positional[1] ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      if (profileUrls.length === 0) throw new Error('--urls requires at least one URL.');
      params = { profileUrls, mode: toScrapingMode(positional[2]) };
    } else {
      params = {
        categoryUrl: positional[0] ?? DEFAULT_CATEGORY_URL,
        mode: toScrapingMode(positional[1]),
      };
    }

    const startedAt = Date.now();
    const { records, summary, stopReason } = await runPipeline(params, {
      onDiscovered: ({ discovered }) =>
        process.stdout.write(`\nDiscovered ${discovered} company URL(s) — all will be checked\n`),
      // Every company prints, exported or not. Under `all` that is the file;
      // under `with-email` the DROPPED blocks are exactly the difference
      // between the two modes, which is the thing worth seeing.
      onProgress: (snapshot, record, info) => printCompany(record, snapshot, info.exported),
    });
    const elapsedMs = Date.now() - startedAt;

    printSummary(summary, stopReason, params.mode, records.length);
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
