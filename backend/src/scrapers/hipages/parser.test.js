/**
 * hipages — parser test script.
 *
 * Reads a saved `page.html` capture off disk, runs it through
 * `parser.parseProfilePage()`, and prints the result. No network, no browser,
 * no database — the whole point of a pure parser is that verifying it costs a
 * file read.
 *
 * It prints two things: a field-by-field summary (so a regression is visible at
 * a glance) followed by the full object as JSON (so the detail is inspectable
 * and pipeable into a diff).
 *
 * Usage
 * -----
 *   node backend/src/scrapers/hipages/parser.test.js [pathToPageHtml]
 *
 * With no argument it uses the most recent capture under `<data>/inspections`,
 * which is where `inspector.js` writes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../../config/env.js';
import { parseProfilePage, readHydrationData, readJsonLdBusiness } from './parser.js';

const INSPECTIONS_DIR = path.join(config.paths.data, 'inspections');
const CAPTURE_FILE = 'page.html';

/**
 * Locates the newest capture directory containing a `page.html`.
 *
 * Capture folders are named with a leading ISO timestamp, so a lexical sort is
 * a chronological sort — no need to stat every directory.
 *
 * @returns {Promise<string>} Absolute path to the HTML file.
 */
async function findLatestCapture() {
  let entries;
  try {
    entries = await fs.readdir(INSPECTIONS_DIR, { withFileTypes: true });
  } catch {
    throw new Error(
      `No inspections directory at ${INSPECTIONS_DIR}. Pass a path to a page.html explicitly.`,
    );
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of candidates) {
    const candidate = path.join(INSPECTIONS_DIR, name, CAPTURE_FILE);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Capture folder without HTML — keep looking.
    }
  }

  throw new Error(`No ${CAPTURE_FILE} found under ${INSPECTIONS_DIR}.`);
}

/**
 * One-line description of what a parsed field actually contains.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (value === null || value === undefined) return '— missing';
  if (Array.isArray(value)) {
    if (value.length === 0) return '— empty';
    const first = value[0]?.name ?? value[0]?.reviewerName ?? value[0]?.fileName ?? '';
    return `${value.length} item(s)${first ? ` — first: ${first}` : ''}`;
  }
  if (typeof value === 'object') {
    const populated = Object.entries(value).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined,
    );
    return `${populated.length}/${Object.keys(value).length} key(s) populated`;
  }
  const text = String(value).replace(/\s+/g, ' ');
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

/**
 * @param {string} htmlPath
 */
async function run(htmlPath) {
  const html = await fs.readFile(htmlPath, 'utf8');

  process.stdout.write(`\nSource : ${htmlPath}\n`);
  process.stdout.write(`Bytes  : ${Buffer.byteLength(html).toLocaleString()}\n`);
  process.stdout.write(
    `Inputs : hydration payload ${readHydrationData(html) ? 'found' : 'MISSING'}, ` +
      `JSON-LD business node ${readJsonLdBusiness(html) ? 'found' : 'MISSING'}\n`,
  );

  const profile = parseProfilePage(html);

  process.stdout.write('\n── Field summary ───────────────────────────────────────────\n');
  for (const [field, value] of Object.entries(profile)) {
    process.stdout.write(`${field.padEnd(18)} ${describe(value)}\n`);
  }

  process.stdout.write('\n── Parsed object ───────────────────────────────────────────\n');
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  try {
    const [argPath] = process.argv.slice(2);
    const htmlPath = argPath ? path.resolve(argPath) : await findLatestCapture();
    await run(htmlPath);
  } catch (error) {
    process.stderr.write(`\nParse test failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default run;
