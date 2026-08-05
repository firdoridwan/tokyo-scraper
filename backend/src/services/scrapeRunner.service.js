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
 * What a run is aiming at
 * -----------------------
 * A job asks for a number of EMAILS. The pipeline decides when it has them and
 * hands back only the companies that qualified; this module's share of that
 * requirement is entirely in how the outcome is worded and measured — see
 * `toProgress()` and `completionMessage()`. It applies no filter of its own and
 * neither do the exporters, which write every record they are given.
 *
 * A run that empties hipages before hitting the target is COMPLETED, at 100%,
 * with a message saying the source ran out. It is not a warning, not a partial
 * success and not a failure: the category holds about a hundred businesses and
 * only some publish an address, so this is the ordinary ending.
 *
 * Asynchronous by design
 * ----------------------
 * `enqueue()` schedules the work and returns; `POST /api/v1/jobs` answers
 * immediately with a `queued` job. The run then proceeds in the background and
 * writes its progress onto the job record, which `GET /api/v1/jobs/:id` already
 * serves. A caller learns what happened by asking, not by waiting.
 *
 * That removes the ceiling the synchronous design had: a run took roughly ten
 * seconds per company against a 5-minute HTTP request timeout, so ~24 companies
 * was the hard maximum. Nothing is waiting on the socket now, so the run may
 * take as long as it takes.
 *
 * There is no queue, no broker and no worker process — just a task the event
 * loop picks up after the response has been flushed. See "why this is safe" in
 * `runInBackground()`.
 *
 * Not implemented here, deliberately: concurrency (`p-limit`), retries, and
 * persisting individual rows through `resultRepository` — the CSV and the
 * workbook are this milestone's output, and none of those were asked for.
 */
import { JOB_STATUS, TERMINAL_JOB_STATUSES } from '../config/constants.js';
import { runPipeline } from './scrapingPipeline.service.js';
import { exportCompaniesToCsv } from './csvExporter.service.js';
import { exportCompaniesToXlsx } from './excelExporter.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Cancellation handles for in-flight runs, keyed by job id.
 *
 * A background run has no request to abandon, so this map is the only way to
 * reach one after it has started. Entries are removed in a `finally`, so a
 * crashed run cannot leave a handle behind.
 *
 * @type {Map<string, { abortController: AbortController }>}
 */
const activeRuns = new Map();

/** Counters the job carries while it runs. Same shape as the pipeline summary. */
const EMPTY_SUMMARY = Object.freeze({
  discovered: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  emailsFound: 0,
});

/**
 * Pluralises a count with its noun. Four messages below need it and each one
 * reads worse for hand-rolling it inline.
 *
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 */
const quantity = (value, singular, plural) => `${value} ${value === 1 ? singular : plural}`;

/**
 * How far through the job the run is, as a percentage.
 *
 * This measures completion of the JOB, not attainment of the target, and the
 * distinction decides the number. A run finishes when EITHER enough emails have
 * been collected OR the source runs dry, so progress is how close the run is to
 * whichever ending arrives first — the larger of the two ratios.
 *
 * Reporting only `emailsFound / target` would strand an exhausted run at, say,
 * 62% and then snap it to 100% at the end, which reads as a bar that gave up.
 * Reporting only `processed / discovered` would race towards 100% while
 * collecting nothing. The maximum of the two rises smoothly under either
 * ending and arrives at 100% exactly when the run is over.
 *
 * @param {typeof EMPTY_SUMMARY} summary
 * @param {number|null} target Requested email count, or null for "no target"
 * @returns {number} 0–100
 */
export function toProgress(summary, target) {
  const towardsTarget = target ? summary.emailsFound / target : 0;
  const towardsExhaustion = summary.discovered ? summary.processed / summary.discovered : 0;

  return Math.min(100, Math.round(Math.max(towardsTarget, towardsExhaustion) * 100));
}

/**
 * The sentence a finished run is described by.
 *
 * Both endings are a success. An exhausted source is not a warning and not a
 * shortfall to apologise for — hipages holds roughly a hundred businesses per
 * category and suburb, so running out of them is an ordinary, expected way for
 * a run to finish. The message says which ending it was, because that is the
 * one thing the counters cannot show.
 *
 * @param {import('./scrapingPipeline.service.js').StopReason} stopReason
 * @param {typeof EMPTY_SUMMARY} summary
 * @param {number|null} target
 * @returns {string}
 */
export function completionMessage(stopReason, summary, target) {
  const emails = quantity(summary.emailsFound, 'email', 'emails');
  const checked = quantity(summary.processed, 'company', 'companies');

  if (stopReason === 'source-exhausted') {
    return (
      `Hipages has no more companies. ${emails} ` +
      `${summary.emailsFound === 1 ? 'was' : 'were'} collected from ${checked} checked.`
    );
  }

  return (
    `Target of ${quantity(target ?? summary.emailsFound, 'email', 'emails')} reached. ` +
    `${checked} ${summary.processed === 1 ? 'was' : 'were'} checked.`
  );
}

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

/**
 * Records a cancelled run's final state.
 *
 * `jobService.cancel()` has already written `cancelled`; this preserves that
 * status while attaching the counters reached before the stop, so a cancelled
 * job still says how far it got. No export is written — a partial file
 * indistinguishable from a complete one is worse than no file.
 *
 * @param {import('../repositories/types.js').Job} job
 * @param {import('../repositories/types.js').JobRepository} jobRepository
 * @param {typeof EMPTY_SUMMARY} summary
 */
function finishCancelled(job, jobRepository, summary) {
  logger.warn('Job cancelled mid-run', {
    jobId: job.id,
    checked: summary.processed,
    emailsFound: summary.emailsFound,
  });

  return jobRepository.update(job.id, {
    status: JOB_STATUS.CANCELLED,
    message:
      `Cancelled after ${quantity(summary.emailsFound, 'email', 'emails')} collected from ` +
      `${quantity(summary.processed, 'company', 'companies')} checked.`,
    resultCount: summary.emailsFound,
    summary,
    finishedAt: new Date().toISOString(),
  });
}

export const scrapeRunner = {
  /** The pipeline exists, so the engine can execute an implemented source. */
  get isEngineAvailable() {
    return true;
  },

  /**
   * Schedules a job and returns immediately.
   *
   * `setImmediate` is what separates "accepted" from "done": the callback runs
   * on the next iteration of the event loop, by which point Express has already
   * written and flushed the 201. The caller is never waiting on the scrape.
   *
   * Returns the job unchanged — still `queued`. The run itself moves it to
   * `running`, and every later state is read back through the repository.
   *
   * @param {import('../repositories/types.js').Job} job
   * @param {import('../repositories/types.js').JobRepository} jobRepository
   * @returns {import('../repositories/types.js').Job} The queued job
   */
  enqueue(job, jobRepository) {
    setImmediate(() => {
      // `run()` records its own failures on the job; this catch is the guard
      // against a bug INSIDE that recording. Nothing awaits this promise, so an
      // unhandled rejection here would take the process down with it.
      this.run(job, jobRepository).catch((error) => {
        logger.error('Background run threw after recording its own failure', {
          jobId: job.id,
          message: error?.message,
        });
      });
    });

    logger.info('Job queued', { jobId: job.id, sourceId: job.sourceId });
    return job;
  },

  /**
   * Runs one job to completion, writing progress onto the record as it goes.
   *
   * Nothing is listening for the return value in production — the job record is
   * the channel. Every exit path therefore has to leave the record in a terminal
   * state; a run that threw without writing `failed` would leave a job stuck in
   * `running` forever, which is the one failure mode a poll-based UI cannot
   * recover from.
   *
   * @param {import('../repositories/types.js').Job} job
   * @param {import('../repositories/types.js').JobRepository} jobRepository
   * @returns {Promise<import('../repositories/types.js').Job>}
   */
  async run(job, jobRepository) {
    const params = job.params ?? {};
    const controller = new AbortController();
    activeRuns.set(job.id, { abortController: controller });

    logger.info('Job started', { jobId: job.id, sourceId: job.sourceId, params });

    /**
     * The email target, and the denominator half of the progress bar.
     *
     * `limit` keeps its name and its place as the one number the operator sets;
     * what it counts is now emails rather than companies. The pipeline reads it
     * the same way — see `toEmailTarget()` — so the two cannot disagree about
     * what an absent or nonsensical value means.
     */
    const target = params.limit > 0 ? Number(params.limit) : null;

    /**
     * Live counters, published on the job after every company.
     *
     * Copied from the pipeline's own snapshot rather than tallied here. The
     * runner used to increment its own counters from the callbacks, which meant
     * two implementations of the same arithmetic and two chances to disagree
     * about what "skipped" meant. Now there is one counter, and this is its
     * mirror.
     */
    let live = { ...EMPTY_SUMMARY };

    /**
     * Writes the counters onto the record.
     *
     * @param {string} message
     */
    const publish = (message) => {
      jobRepository.update(job.id, {
        summary: { ...live },
        // What the run produces is emails, so that is what a result count is.
        resultCount: live.emailsFound,
        progress: toProgress(live, target),
        message,
      });
    };

    jobRepository.update(job.id, {
      status: JOB_STATUS.RUNNING,
      startedAt: new Date().toISOString(),
      message: 'Running — collecting companies.',
      summary: { ...live },
    });

    try {
      // Only the parameters the source declares reach this point — anything
      // else was dropped by `normalizeParams()` against the descriptor.
      //
      // An email count is the whole request. How many companies it takes to
      // find that many addresses is not knowable in advance and is nothing an
      // operator should be asked to estimate.
      const { records, summary, stopReason } = await runPipeline(
        {
          categoryUrl: requireCategoryUrl(params.categoryUrl),
          limit: params.limit,
        },
        {
          signal: controller.signal,

          onDiscovered: ({ discovered }) => {
            live = { ...live, discovered };
            publish(
              `Running — ${quantity(discovered, 'company', 'companies')} available to check.`,
            );
          },

          // One call per company checked, qualified or not. The record is
          // ignored here: the counters already say everything the job record
          // publishes, and the rows themselves go to the exporters at the end.
          onProgress: (snapshot) => {
            live = snapshot;
            publish(
              `Running — ${quantity(live.processed, 'company', 'companies')} checked, ` +
                `${quantity(live.emailsFound, 'email', 'emails')} found.`,
            );
          },
        },
      );

      // `summary` and `live` now agree — the pipeline counts as it goes and
      // hands back the same object it has been publishing — so either would do
      // here. `summary` is used because it is the run's own final word.
      if (controller.signal.aborted) return finishCancelled(job, jobRepository, summary);

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
        stopReason,
        checked: summary.processed,
        emailsFound: summary.emailsFound,
        csv: csv.fileName,
        xlsx: xlsx.fileName,
      });

      return jobRepository.update(job.id, {
        status: JOB_STATUS.COMPLETED,
        // 100 regardless of which ending arrived. An exhausted source is a
        // finished job, not a stalled one, and a bar left short of the end
        // would report it as the failure it is not.
        progress: 100,
        resultCount: summary.emailsFound,
        message: completionMessage(stopReason, summary, target),
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
      if (controller.signal.aborted) {
        return finishCancelled(job, jobRepository, { ...live });
      }

      logger.error('Job failed', { jobId: job.id, message: error.message });

      return jobRepository.update(job.id, {
        status: JOB_STATUS.FAILED,
        message: 'Run failed.',
        error: error.message,
        summary: { ...live },
        finishedAt: new Date().toISOString(),
      });
    } finally {
      activeRuns.delete(job.id);
    }
  },


  /**
   * Requests cancellation of a running job.
   *
   * Now that runs are detached, this is real: the handle registered in
   * `activeRuns` aborts the signal the pipeline is watching, which stops it
   * between companies. `jobService.cancel()` marks the record regardless, so a
   * job that has not started yet is still cancelled correctly.
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
