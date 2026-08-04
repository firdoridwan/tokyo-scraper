/**
 * hipages — page inspector.
 *
 * A manual reconnaissance tool, not part of the scraping engine. It opens ONE
 * operator-supplied hipages page and captures two artefacts: the settled HTML
 * and a full-page screenshot.
 *
 * Why it exists
 * -------------
 * `selectors.js` must never contain a guessed selector. The only honest way to
 * write one is to read the real markup, and the only honest way to read the real
 * markup is to capture it once, deliberately, from a page a human chose. That is
 * this file's entire job.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * No parsing, no extraction, no link-following, no pagination, no persistence,
 * no CSV. It navigates, captures, and closes. Anything beyond that belongs to
 * `crawler.js` / `parser.js` / `extractor.js` and their own sprints.
 *
 * Usage
 * -----
 *   node backend/src/scrapers/hipages/inspector.js "<url>" [outputDir]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const log = logger.child({ sourceId: 'hipages', module: 'inspector' });

/** Desktop viewport — wide enough that the page renders its full-width layout. */
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Grace period for the network to fall quiet after `load` fires.
 * Exceeding it is not an error: many pages keep long-lived connections open
 * (analytics beacons, websockets) and would never reach a truly idle state.
 */
const SETTLE_TIMEOUT_MS = 10_000;

const FILE_NAMES = Object.freeze({
  html: 'page.html',
  screenshot: 'screenshot.png',
});

/**
 * Validates the operator-supplied URL.
 *
 * Fails loudly rather than letting Playwright interpret a malformed string —
 * a typo should stop the run, not silently open `about:blank`.
 *
 * @param {string} rawUrl
 * @returns {URL}
 */
function parseTargetUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('A target URL is required.');
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol "${url.protocol}" — use http or https.`);
  }

  return url;
}

/**
 * Builds a unique, human-readable directory name for one capture.
 *
 * The URL path is folded into the name so several captures sit side by side and
 * remain identifiable; the timestamp guarantees a re-run never overwrites an
 * earlier capture.
 *
 * @param {URL} url
 * @returns {string}
 */
function buildCaptureDirName(url) {
  const slug =
    url.pathname
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${slug}`;
}

/**
 * Opens one page and writes its HTML and full-page screenshot to disk.
 *
 * @param {string} rawUrl                       Page to open
 * @param {{ outputDir?: string }} [options]    Explicit destination directory;
 *                                              defaults to a timestamped folder
 *                                              under `<data>/inspections`.
 * @returns {Promise<{ url: string, outputDir: string, htmlPath: string, screenshotPath: string }>}
 */
export async function inspectPage(rawUrl, options = {}) {
  const url = parseTargetUrl(rawUrl);

  const outputDir =
    options.outputDir ??
    path.join(config.paths.data, 'inspections', buildCaptureDirName(url));

  const htmlPath = path.join(outputDir, FILE_NAMES.html);
  const screenshotPath = path.join(outputDir, FILE_NAMES.screenshot);

  await fs.mkdir(outputDir, { recursive: true });

  log.info('Launching browser', { headless: config.scraper.headless });
  const browser = await chromium.launch({ headless: config.scraper.headless });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      userAgent: config.scraper.userAgent,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(config.scraper.navigationTimeoutMs);

    log.info('Opening page', { url: url.href });
    const response = await page.goto(url.href, { waitUntil: 'load' });
    log.info('Page loaded', { status: response?.status() ?? null });

    // Best-effort settle so late-rendered markup is present in the capture.
    try {
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      log.debug('Network never fell idle — capturing the page as it stands.');
    }

    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    log.info('Saved HTML', { path: htmlPath, bytes: Buffer.byteLength(html) });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    log.info('Saved screenshot', { path: screenshotPath });

    return { url: url.href, outputDir, htmlPath, screenshotPath };
  } finally {
    await browser.close();
    log.info('Browser closed');
  }
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [rawUrl, outputDir] = process.argv.slice(2);

  if (!rawUrl) {
    process.stderr.write(
      'Usage: node backend/src/scrapers/hipages/inspector.js "<url>" [outputDir]\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await inspectPage(rawUrl, outputDir ? { outputDir } : {});
    process.stdout.write(`\nCapture complete: ${result.outputDir}\n`);
  } catch (error) {
    log.error('Inspection failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default inspectPage;
