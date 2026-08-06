/**
 * CSV exporter — CLI test script.
 *
 * Runs the pipeline, exports one CSV, verifies the file is actually on disk,
 * and reports.
 *
 *   run pipeline → export CSV → stat the file → print
 *
 * The verification step is a real check, not a formality: `writeRecords()`
 * resolving is a promise settling, while `Export Success` is meant to mean "a
 * readable, non-empty file exists at this path". Those are different claims, so
 * the file is opened and measured before the second one is made.
 *
 * Usage
 * -----
 *   node backend/src/services/csvExporter.test.js [categoryUrl] [all|with-email]
 *   node backend/src/services/csvExporter.test.js --urls <profileUrl>[,<profileUrl>...] [mode]
 *
 * The second argument is the SCRAPING MODE, not a size. Nothing caps a run any
 * more — every company in the category is checked under either mode — so pick a
 * small category (a regional suburb) rather than the Sydney default when you
 * want a short one.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runPipeline, toScrapingMode } from './scrapingPipeline.service.js';
import { exportCompaniesToCsv } from './csvExporter.service.js';

const DEFAULT_CATEGORY_URL = 'https://hipages.com.au/find/electricians/nsw/sydney';
const RULE = '-'.repeat(40);

/**
 * Confirms the export is a readable file with content.
 *
 * @param {string} filePath
 * @returns {Promise<{ exists: boolean, bytes: number, headerLine: string|null, dataLines: number }>}
 */
async function verifyFile(filePath) {
  try {
    const { size } = await fs.stat(filePath);
    const text = await fs.readFile(filePath, 'utf8');
    const lines = text.split('\n').filter((line) => line.trim() !== '');

    return {
      exists: true,
      bytes: size,
      headerLine: lines[0] ?? null,
      dataLines: Math.max(0, lines.length - 1),
    };
  } catch {
    return { exists: false, bytes: 0, headerLine: null, dataLines: 0 };
  }
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const args = process.argv.slice(2);

  try {
    /** @type {{ categoryUrl?: string, profileUrls?: string[], mode: string }} */
    let params;

    if (args[0] === '--urls') {
      const profileUrls = (args[1] ?? '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);
      if (profileUrls.length === 0) throw new Error('--urls requires at least one URL.');
      params = { profileUrls, mode: toScrapingMode(args[2]) };
    } else {
      params = { categoryUrl: args[0] ?? DEFAULT_CATEGORY_URL, mode: toScrapingMode(args[1]) };
    }

    const { records, summary } = await runPipeline(params, {
      onDiscovered: ({ discovered }) =>
        process.stdout.write(`\nDiscovered ${discovered} company URL(s) — all will be checked\n`),
      onProgress: (snapshot, record, info) =>
        process.stdout.write(
          `  ${String(snapshot.processed).padStart(3)}  ${info.exported ? 'EXPORTED' : 'DROPPED '} ` +
            `${record.companyName ?? '—'} <${record.email ?? '—'}>\n`,
        ),
    });

    const exported = await exportCompaniesToCsv(records);
    const verified = await verifyFile(exported.filePath);

    process.stdout.write(`\n${RULE}\n\n`);
    process.stdout.write(`Scraping Mode: ${params.mode}\n\n`);
    process.stdout.write(`Companies Processed: ${summary.processed}\n\n`);
    process.stdout.write(`Companies Exported: ${summary.exported}\n\n`);
    process.stdout.write(`Rows Written: ${exported.rowsWritten}\n\n`);
    process.stdout.write(`CSV Path: ${exported.filePath}\n\n`);
    process.stdout.write(`Export Success: ${verified.exists ? 'YES' : 'NO'}\n\n`);
    process.stdout.write(`${RULE}\n\n`);

    process.stdout.write(`File size:    ${verified.bytes.toLocaleString()} bytes\n`);
    process.stdout.write(`Header:       ${verified.headerLine ?? '—'}\n`);
    process.stdout.write(`Data lines:   ${verified.dataLines}\n\n`);

    // One row per EXPORTED company. `summary.exported` is what the mode decided
    // and `rowsWritten` is what the file actually holds, so comparing them is
    // the real check: it catches an exporter that dropped a record as well as a
    // predicate the exporter disagreed with. A mismatch is a failure, not a note.
    if (!verified.exists || exported.rowsWritten !== summary.exported) {
      throw new Error(
        `Export mismatch — ${summary.exported} companies exported under mode ` +
          `"${params.mode}", ${exported.rowsWritten} rows written, ` +
          `file exists: ${verified.exists}.`,
      );
    }

    // And the file's own data lines have to agree with both.
    if (verified.dataLines !== summary.exported) {
      throw new Error(
        `File mismatch — ${summary.exported} exported, ${verified.dataLines} data lines on disk.`,
      );
    }
  } catch (error) {
    process.stderr.write(`\nCSV export test failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default main;
