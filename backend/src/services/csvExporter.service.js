/**
 * CSV exporter.
 *
 * Takes the company records the scraping pipeline returns and writes exactly
 * one CSV file. It does not scrape, does not fetch, does not open a browser and
 * does not know where the records came from — hand it an array, get a file.
 *
 * Formatting is the whole job
 * ---------------------------
 * The pipeline's record is a nested object: `businessLocation` is a five-field
 * object, `credentials` holds an ABN plus a licence list plus insurance, and
 * `services`, `reviews` and `gallery` are arrays. A spreadsheet cell is a
 * string. So every column here is a deliberate flattening decision, and the
 * rule behind each one is the same: a person opening the file in Excel must be
 * able to read the cell.
 *
 * `JSON.stringify` is therefore never used on a value. `[object Object]` and
 * `[{"name":"Electrician","seoKey":null}]` are both technically "the data" and
 * neither is readable, so arrays are joined and objects are rendered into
 * sentences.
 *
 * Absence stays absent: a field the profile never carried writes an empty cell,
 * not `null`, not `N/A`, not `0`. Inventing a value in an export is the same
 * offence as inventing one in a parser.
 *
 * Scope
 * -----
 * One file per call, no append mode, no second format, no database. The
 * pipeline, parser, API and frontend are untouched — this module is downstream
 * of all of them.
 *
 * Usage
 * -----
 *   node backend/src/services/csvExporter.service.js "<recordsJsonPath>"
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createObjectCsvWriter } from 'csv-writer';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'csvExporter' });

/**
 * The eleven columns, in the order they must appear.
 *
 * `id` is the key on the flattened row, `title` is the header text. The array
 * IS the column order — csv-writer emits them exactly as listed, so this is the
 * single place the order is defined.
 */
const COLUMNS = Object.freeze([
  { id: 'companyName', title: 'Company Name' },
  { id: 'phoneNumber', title: 'Phone Number' },
  { id: 'website', title: 'Website' },
  { id: 'email', title: 'Email' },
  { id: 'businessLocation', title: 'Business Location' },
  { id: 'rating', title: 'Rating' },
  { id: 'totalReviews', title: 'Total Reviews' },
  { id: 'credentials', title: 'Credentials' },
  { id: 'services', title: 'Services' },
  { id: 'hipagesUrl', title: 'Hipages URL' },
  { id: 'status', title: 'Status' },
]);

/** Separator for every multi-value cell — services, licences, address parts. */
const VALUE_SEPARATOR = '; ';

/**
 * Renders a value as a cell, collapsing every flavour of "nothing" to an empty
 * string.
 *
 * `0` and `false` are values, not absence, so they survive — a company with
 * zero reviews is different from a company whose review count is unknown.
 *
 * @param {unknown} value
 * @returns {string}
 */
function toCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

/**
 * Joins the parts of a multi-value cell, dropping the empty ones.
 *
 * @param {unknown[]} parts
 * @returns {string}
 */
function joinParts(parts) {
  return parts.map(toCell).filter((part) => part !== '').join(VALUE_SEPARATOR);
}

/**
 * Business Location — one readable address.
 *
 * `displayAddress` is preferred because it is the address hipages itself shows
 * ("Kogarah NSW 2217"); the component fields are assembled only when it is
 * missing, so the cell never reads "Kogarah, Kogarah NSW 2217".
 *
 * @param {object|null} location
 * @returns {string}
 */
function formatLocation(location) {
  if (!location) return '';

  const display = toCell(location.displayAddress);
  if (display !== '') return display;

  return [location.suburb, location.state, location.postcode]
    .map(toCell)
    .filter((part) => part !== '')
    .join(' ');
}

/**
 * Credentials — ABN, licences and insurance as a sentence.
 *
 * A licence reads `NSW Fair Trading 284952C (verified)`. The verified marker is
 * only added when hipages actually verified it: writing "(unverified)" would
 * assert something the profile does not say.
 *
 * @param {object|null} credentials
 * @returns {string}
 */
function formatCredentials(credentials) {
  if (!credentials) return '';

  const abn = toCell(credentials.abn);
  const parts = abn === '' ? [] : [`ABN ${abn}`];

  for (const licence of credentials.licences ?? []) {
    const label = [licence?.name, licence?.number]
      .map(toCell)
      .filter((part) => part !== '')
      .join(' ');
    if (label === '') continue;
    parts.push(licence?.verified ? `${label} (verified)` : label);
  }

  if (credentials.insurance?.hasPublicLiability) parts.push('Public liability insurance');
  for (const type of credentials.insurance?.types ?? []) {
    const label = toCell(typeof type === 'string' ? type : type?.name);
    if (label !== '') parts.push(label);
  }

  return parts.join(VALUE_SEPARATOR);
}

/**
 * Services — names only, joined with `; `.
 *
 * The parser's `seoKey` is dropped: it is a routing slug, not information a
 * reader of the spreadsheet wants next to the service name.
 *
 * @param {object[]} services
 * @returns {string}
 */
function formatServices(services) {
  if (!Array.isArray(services)) return '';
  return joinParts(services.map((service) => service?.name));
}

/**
 * Total Reviews — the count, never the reviews themselves.
 *
 * `hipagesRating.ratingCount` is the site's own total and is preferred: the
 * `reviews` array holds only the reviews the page published (ten, typically),
 * so using its length would under-report a company with 27 reviews. When there
 * is no rating block, the number of reviews actually read is the only count
 * that exists — and when there are none of those either, the cell stays empty
 * rather than claiming zero.
 *
 * @param {object} record
 * @returns {number|null}
 */
function totalReviews(record) {
  const counted = record.hipagesRating?.ratingCount;
  if (typeof counted === 'number' && Number.isFinite(counted)) return counted;

  const parsed = Array.isArray(record.reviews) ? record.reviews.length : 0;
  return parsed > 0 ? parsed : null;
}

/**
 * Flattens one pipeline record into one CSV row.
 *
 * Exported because it is the part worth testing: it is pure, and every rule in
 * this sprint ("empty stays empty", "never stringify an array", "services
 * joined with `; `") is enforced here rather than at write time.
 *
 * @param {import('./scrapingPipeline.service.js').CompanyRecord} record
 * @returns {Record<string, string>}
 */
export function toCsvRow(record) {
  return {
    companyName: toCell(record.companyName),
    phoneNumber: toCell(record.phoneNumber),
    website: toCell(record.website),
    email: toCell(record.email),
    businessLocation: formatLocation(record.businessLocation),
    rating: toCell(record.hipagesRating?.ratingValue),
    totalReviews: toCell(totalReviews(record)),
    credentials: formatCredentials(record.credentials),
    services: formatServices(record.services),
    hipagesUrl: toCell(record.hipagesUrl),
    // Upper case to match the status the CLI prints, so the two agree on sight.
    status: toCell(record.status).toUpperCase(),
  };
}

/**
 * Builds the export filename: `scraping_YYYY-MM-DD_HH-mm-ss.<extension>`.
 *
 * Local time, not UTC. The capture directories under `data/websites` use ISO
 * timestamps because nothing reads them by eye; an export lands in the
 * operator's downloads and gets picked out of a list by hand, so it carries the
 * operator's clock.
 *
 * The extension is a parameter so every export format shares one naming rule —
 * pass the same `now` to two exporters and their files pair up by name.
 *
 * @param {Date} [now]
 * @param {string} [extension] Without the dot. Defaults to `csv`.
 * @returns {string}
 */
export function buildExportFileName(now = new Date(), extension = 'csv') {
  const pad = (value) => String(value).padStart(2, '0');

  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-');

  return `scraping_${date}_${time}.${extension}`;
}

/**
 * @typedef {object} ExportResult
 * @property {string} filePath    Absolute path to the file just written
 * @property {string} fileName
 * @property {number} rowsWritten One row per company — the header is not a row
 * @property {number} bytes
 */

/**
 * Writes one CSV file from the pipeline's records.
 *
 * The header is always written, even for an empty run: a file with a header and
 * no rows says "nothing was found", while an empty file says "something broke".
 *
 * @param {import('./scrapingPipeline.service.js').CompanyRecord[]} records
 * @param {{ outputDir?: string, fileName?: string, now?: Date }} [options]
 * @returns {Promise<ExportResult>}
 */
export async function exportCompaniesToCsv(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('exportCompaniesToCsv() requires an array of company records.');
  }

  const outputDir = options.outputDir ?? config.paths.exports;
  const fileName = options.fileName ?? buildExportFileName(options.now);
  const filePath = path.join(outputDir, fileName);

  await fs.mkdir(outputDir, { recursive: true });

  const writer = createObjectCsvWriter({
    path: filePath,
    header: [...COLUMNS],
    encoding: 'utf8',
  });

  const rows = records.map(toCsvRow);
  await writer.writeRecords(rows);

  const { size } = await fs.stat(filePath);
  log.info('CSV written', { filePath, rows: rows.length, bytes: size });

  return { filePath, fileName, rowsWritten: rows.length, bytes: size };
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [recordsPath] = process.argv.slice(2);

  if (!recordsPath) {
    process.stderr.write(
      'Usage: node backend/src/services/csvExporter.service.js "<recordsJsonPath>"\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const records = JSON.parse(await fs.readFile(recordsPath, 'utf8'));
    const result = await exportCompaniesToCsv(records);
    process.stdout.write(`${result.filePath}\n`);
  } catch (error) {
    log.error('CSV export failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export const csvExporter = { exportCompaniesToCsv, toCsvRow, buildExportFileName, COLUMNS };

export default csvExporter;
