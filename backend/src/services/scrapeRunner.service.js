/**
 * Scrape runner — the execution engine boundary.
 *
 * PLACEHOLDER. The real runner will:
 *   1. resolve the adapter via `registry.loadScraperFor(sourceId)`
 *   2. launch a Playwright context with `config.scraper` options
 *   3. drive the BaseScraper lifecycle under a `p-limit` concurrency cap
 *   4. stream progress through `jobRepository.update`
 *   5. persist rows through `resultRepository.createMany`
 *
 * Today it accepts a job and parks it, so the API and UI have a truthful
 * end-to-end path with no fabricated data. Everything upstream of this module
 * (routes, controllers, services, repositories) is final.
 */
import { JOB_STATUS, TERMINAL_JOB_STATUSES } from '../config/constants.js';
import { isSourceImplemented } from '../scrapers/registry.js';
import { logger } from '../utils/logger.js';

/** Tracks cancellation handles for in-flight jobs. Unused until the engine runs. */
const activeRuns = new Map();

export const scrapeRunner = {
  /** True once at least one source has a working adapter. */
  get isEngineAvailable() {
    return false;
  },

  /**
   * Hands a queued job to the engine.
   *
   * @param {import('../repositories/types.js').Job} job
   * @param {import('../repositories/types.js').JobRepository} jobRepository
   * @returns {import('../repositories/types.js').Job}
   */
  enqueue(job, jobRepository) {
    const implemented = isSourceImplemented(job.sourceId);

    logger.warn('Scrape engine not implemented — job parked in queue', {
      jobId: job.id,
      sourceId: job.sourceId,
      sourceImplemented: implemented,
    });

    return (
      jobRepository.update(job.id, {
        status: JOB_STATUS.QUEUED,
        message:
          'Queued. The scraping engine is not implemented yet — this job will start once the source module is built.',
      }) ?? job
    );
  },

  /**
   * Requests cancellation of a running job.
   *
   * @param {string} jobId
   * @returns {boolean} whether an in-flight run was signalled
   */
  cancel(jobId) {
    const run = activeRuns.get(jobId);
    if (!run) return false;
    run.abortController.abort();
    activeRuns.delete(jobId);
    return true;
  },

  /** @param {string} status */
  isTerminal(status) {
    return TERMINAL_JOB_STATUSES.includes(status);
  },
};

export default scrapeRunner;
