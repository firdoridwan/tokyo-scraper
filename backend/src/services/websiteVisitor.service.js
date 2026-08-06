/**
 * Company website visitor.
 *
 * Opens ONE company homepage and captures two artefacts: the settled HTML and a
 * full-page screenshot. That is the whole job.
 *
 * Why this is a service and not part of the hipages module
 * -------------------------------------------------------
 * The pages it opens belong to third parties, not to a directory. Nothing here
 * knows or cares which source produced the URL, so binding it to `scrapers/
 * hipages/` would misplace it — any source that yields a website URL can reuse
 * this unchanged.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * No parsing, no email extraction, no link following, no contact/about pages,
 * no social lookups, no crawling, no persistence beyond the two files. It
 * performs exactly ONE navigation, captures, and closes. Anything that reads
 * meaning out of the captured HTML belongs to a later sprint and a different
 * module — this one writes bytes to disk and stops.
 *
 * Redirects are the one exception, and they are not navigation in the crawling
 * sense: a homepage answering `http://` with `https://`, or bare-domain with
 * `www.`, is still the same single page request. The URL that actually
 * responded is reported back so the redirect is never silent.
 *
 * Usage
 * -----
 *   node backend/src/services/websiteVisitor.service.js "<url>" [outputDir]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'websiteVisitor' });

/** Desktop viewport — wide enough that the site renders its full-width layout. */
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Grace period for the network to fall quiet after `load` fires.
 * Exceeding it is not an error: many sites keep long-lived connections open
 * (analytics beacons, chat widgets, websockets) and would never reach a truly
 * idle state. The capture proceeds with whatever has rendered by then.
 */
const SETTLE_TIMEOUT_MS = 10_000;

const FILE_NAMES = Object.freeze({
  html: 'website.html',
  screenshot: 'website.png',
});

/**
 * Validates the supplied website URL.
 *
 * Fails loudly rather than letting Playwright interpret a malformed string — a
 * directory listing with a junk website field should stop the visit, not
 * silently open `about:blank` and save an empty capture that looks successful.
 *
 * @param {string} rawUrl
 * @returns {URL}
 */
function parseWebsiteUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('A website URL is required.');
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
 * The hostname is folded into the name so several captures sit side by side and
 * remain identifiable; the timestamp guarantees a re-visit never overwrites an
 * earlier capture.
 *
 * @param {URL} url
 * @returns {string}
 */
function buildCaptureDirName(url) {
  const slug =
    url.hostname
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'website';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${slug}`;
}

/**
 * Opens one company homepage and writes its HTML and full-page screenshot.
 *
 * The URL is visited exactly as supplied — it is not rewritten to the site
 * root, because silently discarding part of the operator's input would be a
 * surprising transform. "Homepage only" is enforced by performing a single
 * navigation and never following a link out of it.
 *
 * @param {string} rawUrl                     The company website to open
 * @param {{ outputDir?: string }} [options]  Explicit destination directory;
 *                                            defaults to a timestamped folder
 *                                            under `<data>/websites`.
 * @returns {Promise<{
 *   requestedUrl: string,
 *   finalUrl: string|null,
 *   status: number|null,
 *   outputDir: string,
 *   htmlPath: string,
 *   screenshotPath: string,
 *   htmlBytes: number
 * }>}
 */
export async function visitWebsite(rawUrl, options = {}) {
  const url = parseWebsiteUrl(rawUrl);

  const outputDir =
    options.outputDir ?? path.join(config.paths.data, 'websites', buildCaptureDirName(url));

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

    log.info('Opening website', { url: url.href });
    const response = await page.goto(url.href, { waitUntil: 'load' });
    const status = response?.status() ?? null;
    log.info('Page loaded', { status });

    // Best-effort settle so late-rendered markup is present in the capture.
    try {
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      log.debug('Network never fell idle — capturing the page as it stands.');
    }

    const finalUrl = page.url();
    if (finalUrl !== url.href) {
      log.info('Redirected', { from: url.href, to: finalUrl });
    }

    const html = await page.content();
    const htmlBytes = Buffer.byteLength(html);
    await fs.writeFile(htmlPath, html, 'utf8');
    log.info('Saved HTML', { path: htmlPath, bytes: htmlBytes });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    log.info('Saved screenshot', { path: screenshotPath });

    return {
      requestedUrl: url.href,
      finalUrl,
      status,
      outputDir,
      htmlPath,
      screenshotPath,
      htmlBytes,
    };
  } finally {
    // Never allowed to throw. A `finally` that raises replaces whatever the body
    // produced, so a browser that had already crashed would surface as "Target
    // closed" in place of the real navigation error — and, on the path where the
    // capture had actually succeeded, would turn it into a failure. There is no
    // caller who could act on a browser that will not close; logging is the
    // whole of the correct response.
    try {
      await browser.close();
      log.info('Browser closed');
    } catch (error) {
      log.warn('Failed to close website browser — continuing', { message: error?.message });
    }
  }
}

/** CLI entry point — only runs when this file is executed directly. */
async function main() {
  const [rawUrl, outputDir] = process.argv.slice(2);

  if (!rawUrl) {
    process.stderr.write(
      'Usage: node backend/src/services/websiteVisitor.service.js "<url>" [outputDir]\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await visitWebsite(rawUrl, outputDir ? { outputDir } : {});
    process.stdout.write(
      `\nVisit complete: ${result.outputDir}\n` +
        `  requested : ${result.requestedUrl}\n` +
        `  final     : ${result.finalUrl}\n` +
        `  status    : ${result.status}\n` +
        `  html      : ${FILE_NAMES.html} (${result.htmlBytes.toLocaleString()} bytes)\n` +
        `  screenshot: ${FILE_NAMES.screenshot}\n`,
    );
  } catch (error) {
    log.error('Website visit failed', { message: error.message });
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}

export default visitWebsite;
