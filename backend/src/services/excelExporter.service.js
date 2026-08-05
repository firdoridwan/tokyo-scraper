/**
 * Excel exporter.
 *
 * Writes one `.xlsx` workbook from the same company records the CSV exporter
 * receives. It is an additional format, not a replacement: both files are
 * written from one run, and neither knows about the other.
 *
 * Why this does not re-flatten the records
 * ----------------------------------------
 * Every rule about how a record becomes a cell — services joined with `; `,
 * credentials rendered as a sentence, absent values staying empty, the review
 * count preferring the site's own total — lives in `csvExporter.toCsvRow()`.
 * This module calls it and rearranges the result.
 *
 * That is deliberate. Two exporters with two copies of those rules would drift
 * on the first change, and a spreadsheet whose cells disagree with the CSV's is
 * worse than having no spreadsheet. The one thing added here is typing: Rating
 * and Total Reviews are written back as real numbers so Excel sorts and filters
 * them as numbers rather than as text.
 *
 * The workbook has exactly two sheets: `Companies` (one row per company) and
 * `Summary` (what the run did).
 *
 * Usage
 * -----
 *   node backend/src/services/excelExporter.service.js "<recordsJsonPath>"
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { config } from '../config/env.js';
import { buildExportFileName, toCsvRow } from './csvExporter.service.js';
import { summarise } from './scrapingPipeline.service.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'excelExporter' });

const SHEET_NAMES = Object.freeze({ companies: 'Companies', summary: 'Summary' });

/**
 * Sheet 1's columns, in order.
 *
 * `source` is the key on the row that `csvExporter.toCsvRow()` produces — the
 * link that keeps the two exports saying the same thing. `wrap` marks the two
 * long free-text columns; every other column stays on one line so the grid
 * reads as a table rather than a wall.
 */
const COMPANY_COLUMNS = Object.freeze([
  { header: 'Company', source: 'companyName' },
  { header: 'Email', source: 'email' },
  { header: 'Phone', source: 'phoneNumber' },
  { header: 'Website', source: 'website' },
  { header: 'Business Location', source: 'businessLocation' },
  { header: 'Rating', source: 'rating', numeric: true },
  { header: 'Total Reviews', source: 'totalReviews', numeric: true },
  { header: 'Services', source: 'services', wrap: true },
  { header: 'Credentials', source: 'credentials', wrap: true },
  { header: 'Status', source: 'status' },
]);

/** Header styling — dark fill, white bold text. Readable on screen and in print. */
const HEADER_FILL_ARGB = 'FF1F2937';
const HEADER_FONT_ARGB = 'FFFFFFFF';

/**
 * Width bounds for the auto-sized columns.
 *
 * `MIN` keeps a column of empty cells from collapsing under its own header;
 * `MAX` stops one long website URL from pushing every other column off screen.
 * `WRAPPED` is fixed rather than measured — a wrapped column is sized for how
 * much text should sit on a line, not for its longest value, which for a
 * 49-service list would be thousands of characters.
 */
const WIDTH = Object.freeze({ MIN: 10, MAX: 46, PADDING: 2, WRAPPED: 48 });

/**
 * Converts a cell back to a number when it is one.
 *
 * `toCsvRow()` renders everything as text because a CSV cell is text. In a
 * workbook that would leave Rating as a string, which sorts "10" before "5" and
 * makes a numeric filter impossible. Non-numeric and empty values pass through
 * untouched — an unknown rating stays blank rather than becoming 0.
 *
 * @param {string} value
 * @returns {number|string|null}
 */
function toNumericCell(value) {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

/**
 * Measures a column so its content fits without manual dragging.
 *
 * exceljs has no "autofit" — the width a spreadsheet needs is a function of the
 * rendering font, which is not known when the file is written. Measuring the
 * longest string and clamping it is the standard approximation.
 *
 * @param {{ header: string, wrap?: boolean }} column
 * @param {string[]} values Rendered cell values for this column
 * @returns {number}
 */
function measureWidth(column, values) {
  if (column.wrap) return WIDTH.WRAPPED;

  const longest = values.reduce((max, value) => Math.max(max, String(value ?? '').length), 0);
  const needed = Math.max(column.header.length, longest) + WIDTH.PADDING;

  return Math.min(Math.max(needed, WIDTH.MIN), WIDTH.MAX);
}

/**
 * Formats the run timestamp for the Summary sheet.
 *
 * Written as text, not as a date cell, on purpose: a date cell carries no
 * timezone, so the same workbook shows a different hour depending on where it
 * is opened. A plain string says exactly one thing in Excel, Sheets and
 * Numbers alike.
 *
 * @param {Date} now
 * @returns {string}
 */
function formatGeneratedAt(now) {
  const pad = (value) => String(value).padStart(2, '0');

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/**
 * Builds sheet 1 — one row per company.
 *
 * @param {ExcelJS.Worksheet} sheet
 * @param {Record<string, string>[]} rows Rows as `toCsvRow()` rendered them
 */
function buildCompaniesSheet(sheet, rows) {
  sheet.columns = COMPANY_COLUMNS.map((column) => ({
    header: column.header,
    key: column.source,
    width: measureWidth(
      column,
      rows.map((row) => row[column.source]),
    ),
    style: {
      alignment: { vertical: 'top', wrapText: Boolean(column.wrap) },
    },
  }));

  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        COMPANY_COLUMNS.map((column) => [
          column.source,
          column.numeric ? toNumericCell(row[column.source]) : row[column.source],
        ]),
      ),
    );
  }

  // Header styling is applied last so it wins over the column-level style the
  // header cell inherits — otherwise "Services" would render wrapped and unbold.
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: HEADER_FONT_ARGB } };
  header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
  });
  header.commit();

  // Freeze the header so it stays visible while scrolling a long list.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // The filter covers the header AND the data — Excel needs the full range to
  // populate each dropdown's value list.
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: COMPANY_COLUMNS.length },
  };
}

/**
 * Builds sheet 2 — what the run did.
 *
 * @param {ExcelJS.Worksheet} sheet
 * @param {{ label: string, value: string|number }[]} entries
 */
function buildSummarySheet(sheet, entries) {
  sheet.columns = [
    { key: 'label', width: 24 },
    {
      key: 'value',
      width: Math.min(
        Math.max(...entries.map((entry) => String(entry.value).length + WIDTH.PADDING), WIDTH.MIN),
        70,
      ),
    },
  ];

  for (const entry of entries) {
    const row = sheet.addRow({ label: entry.label, value: entry.value });
    row.getCell('label').font = { bold: true };
    row.getCell('value').alignment = { vertical: 'top' };
  }
}

/**
 * @typedef {object} ExcelExportResult
 * @property {string} filePath
 * @property {string} fileName
 * @property {number} rowsWritten One row per company on the Companies sheet
 * @property {number} bytes
 */

/**
 * Writes one workbook from the pipeline's records.
 *
 * @param {import('./scrapingPipeline.service.js').CompanyRecord[]} records
 * @param {{
 *   summary?: import('./scrapingPipeline.service.js').PipelineSummary,
 *   categoryUrl?: string,
 *   outputDir?: string,
 *   fileName?: string,
 *   now?: Date
 * }} [options] `summary` is the pipeline's own count — passed in rather than
 *   recomputed, because only the run knows how many companies were *discovered*
 *   before `limit` trimmed the list. Without it the counts are derived from the
 *   records alone.
 * @returns {Promise<ExcelExportResult>}
 */
export async function exportCompaniesToXlsx(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('exportCompaniesToXlsx() requires an array of company records.');
  }

  const now = options.now ?? new Date();
  const outputDir = options.outputDir ?? config.paths.exports;
  const fileName = options.fileName ?? buildExportFileName(now, 'xlsx');
  const filePath = path.join(outputDir, fileName);
  const summary = options.summary ?? summarise(records, records.length);

  await fs.mkdir(outputDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tokyo Scraper';
  workbook.created = now;
  workbook.modified = now;

  const rows = records.map(toCsvRow);

  buildCompaniesSheet(workbook.addWorksheet(SHEET_NAMES.companies), rows);
  buildSummarySheet(workbook.addWorksheet(SHEET_NAMES.summary), [
    { label: 'Category URL', value: options.categoryUrl ?? '' },
    { label: 'Companies Discovered', value: summary.discovered },
    { label: 'Companies Processed', value: summary.processed },
    { label: 'Companies Skipped', value: summary.skipped },
    { label: 'Companies Failed', value: summary.failed },
    { label: 'Emails Found', value: summary.emailsFound },
    { label: 'Rows Exported', value: rows.length },
    { label: 'Generated At', value: formatGeneratedAt(now) },
  ]);

  await workbook.xlsx.writeFile(filePath);

  const { size } = await fs.stat(filePath);
  log.info('Workbook written', { filePath, rows: rows.length, bytes: size });

  return { filePath, fileName, rowsWritten: rows.length, bytes: size };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [recordsPath] = process.argv.slice(2);

  if (!recordsPath) {
    process.stderr.write(
      'Usage: node backend/src/services/excelExporter.service.js "<recordsJsonPath>"\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const records = JSON.parse(await fs.readFile(recordsPath, 'utf8'));
    const result = await exportCompaniesToXlsx(records);
    process.stdout.write(`${result.filePath}\n`);
  } catch (error) {
    log.error('Excel export failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export const excelExporter = { exportCompaniesToXlsx, COMPANY_COLUMNS, SHEET_NAMES };

export default excelExporter;
