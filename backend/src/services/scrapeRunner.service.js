/**
 * Scrape runner — the execution engine boundary.
 *
 * Where a job stops being a record and starts being work. It takes a job the
 * job service has already created and validated, runs the existing pipeline
 * with the job's parameters, exports the existing CSV, and writes the outcome
 * back onto the job.
 *
 * It composes; it does not scrape:
 *
 *   scrapingPipeline.runPipeline()      → company records + summary
 *   csvExporter.exportCompaniesToCsv()  → one CSV under `data/exports`
 *   jobRepository.update()              → the job's final state
 *
 * Synchronous by design
 * ---------------------
 * `run()` resolves when the work is finished, so `POST /api/v1/jobs` answers
 * once — with the completed job. That is what lets the UI show a result with no
 * polling, no websocket and no queue. The cost is a long-lived request: a run
 * is roughly ten seconds per company, so the `limit` parameter is what keeps it
 * inside the HTTP server's request timeout.
 *
 * Not implemented here, deliberately: concurrency (`p-limit`), progress
 * streaming, retries, and persisting individual rows through `resultRepository`
 * — the CSV is this milestone's output, and none of those were asked for.
 */
import { JOB_STATUS, TERMINAL_JOB_STATUSES } from '../config/constants.js';
import { runPipeline } from './scrapingPipeline.service.js';
import { exportCompaniesToCsv } from './csvExporter.service.js';
import { exportCompaniesToXlsx } from './excelExporter.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** Tracks cancellation handles for in-flight jobs. Unused while runs are synchronous. */
const activeRuns = new Map();

/**
 * Checks the pasted category URL before a browser is launched.
 *
 * The descriptor can only say "this field is required text"; whether the text
 * is a URL is not knowable there. Without this check a typo reaches `new URL()`
 * deep inside the crawler and surfaces as a generic 500 — the user's most
 * likely mistake reported as a server bug.
 *
 * @param {unknown} value
 * @returns {string} The URL, normalised
 */
function requireCategoryUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw ApiError.validation(`"${value}" is not a valid URL.`, { field: 'categoryUrl' });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ApiError.validation(`Category URL must be http or https, not "${url.protocol}".`, {
      field: 'categoryUrl',
    });
  }

  return url.href;
}

export const scrapeRunner = {
  /** The pipeline exists, so the engine can execute an implemented source. */
  get isEngineAvailable() {
    return true;
  },

  /**
   * Runs one job to completion and returns it in its final state.
   *
   * A failed run is recorded on the job before the error is re-thrown: the HTTP
   * response tells the caller what went wrong, and the stored job carries the
   * same message rather than sitting in `running` forever.
   *
   * @param {import('../repositories/types.js').Job} job
   * @param {import('../repositories/types.js').JobRepository} jobRepository
   * @returns {Promise<import('../repositories/types.js').Job>}
   */
  async run(job, jobRepository) {
    const params = job.params ?? {};

    logger.info('Job started', { jobId: job.id, sourceId: job.sourceId, params });

    jobRepository.update(job.id, {
      status: JOB_STATUS.RUNNING,
      startedAt: new Date().toISOString(),
      message: 'Running — collecting companies.',
    });

    try {
      // Only the parameters the source declares reach this point — anything
      // else was dropped by `normalizeParams()` against the descriptor.
      //
      // A company count is the whole request. How many result pages that takes
      // is the pipeline's arithmetic, not an operator's, and not a second field
      // to keep in step with the first.
      const { records, summary } = await runPipeline({
        categoryUrl: requireCategoryUrl(params.categoryUrl),
        limit: params.limit,
      });

      // Both formats come from the same records and share one timestamp, so a
      // run's two files sit side by side in the exports folder under one name.
      const stamp = new Date();
      const csv = await exportCompaniesToCsv(records, { now: stamp });
      const xlsx = await exportCompaniesToXlsx(records, {
        now: stamp,
        summary,
        categoryUrl: params.categoryUrl,
      });

      logger.info('Job completed', {
        jobId: job.id,
        processed: summary.processed,
        emailsFound: summary.emailsFound,
        csv: csv.fileName,
        xlsx: xlsx.fileName,
      });

      return jobRepository.update(job.id, {
        status: JOB_STATUS.COMPLETED,
        progress: 100,
        resultCount: summary.processed,
        message:
          `Processed ${summary.processed} of ${summary.discovered} discovered ` +
          `compan${summary.discovered === 1 ? 'y' : 'ies'}. ` +
          `${summary.emailsFound} email(s) found.`,
        finishedAt: new Date().toISOString(),
        summary,
        export: {
          // `fileName` stays the CSV: it is the field the export endpoint has
          // always resolved for the default format, and nothing that reads it
          // should have to learn a new shape to keep working.
          fileName: csv.fileName,
          rowsWritten: csv.rowsWritten,
          bytes: csv.bytes,
          files: {
            csv: csv.fileName,
            xlsx: xlsx.fileName,
          },
        },
      });
    } catch (error) {
      logger.error('Job failed', { jobId: job.id, message: error.message });

      jobRepository.update(job.id, {
        status: JOB_STATUS.FAILED,
        message: 'Run failed.',
        error: error.message,
        finishedAt: new Date().toISOString(),
      });

      throw error;
    }
  },

  /**
   * Requests cancellation of a running job.
   *
   * Still a no-op signal: a run occupies its own request from start to finish,
   * so there is no registered handle to abort. `jobService.cancel()` marks the
   * record cancelled regardless.
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
