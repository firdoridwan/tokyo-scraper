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
 * A job asks for a whole category, in one of two SCRAPING MODES. Every company
 * hipages lists is opened and checked either way; the mode decides only which
 * of them the pipeline hands back. This module's share of that requirement is
 * entirely in how the outcome is worded and measured — see `toProgress()` and
 * `completionMessage()`. It applies no filter of its own and neither do the
 * exporters, which write every record they are given.
 *
 * Because the run is never cut short, a completed job has always reached the
 * end of the source. That is the ordinary ending, not a shortfall: the category
 * holds about a hundred businesses, and having checked all of them is the job
 * done.
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
 * loop picks up after the response has been flushed.
 *
 * Who may write a terminal state
 * ------------------------------
 * Exactly one writer, once, per ending:
 *
 *   completed / failed   this module, at the end of `run()`
 *   cancelled            `jobService.cancel()`, at the moment it is requested
 *
 * A run that discovers it was cancelled writes NOTHING. It used to write the
 * final `cancelled` record itself, which made two writers for one ending and
 * meant a terminal record kept changing after the API had already reported it.
 * The repository now refuses writes to a finished job, so the rule is enforced
 * rather than merely intended — see `MemoryJobRepository.update()`.
 *
 * Not implemented here, deliberately: concurrency limits (`p-limit`), retries,
 * and persisting individual rows through `resultRepository` — the CSV and the
 * workbook are this milestone's output, and none of those were asked for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JOB_STATUS, TERMINAL_JOB_STATUSES } from '../config/constants.js';
import { config } from '../config/env.js';
import { runPipeline, toScrapingMode, SCRAPING_MODE } from './scrapingPipeline.service.js';
import { exportCompaniesToCsv, buildExportFileName } from './csvExporter.service.js';
import { exportCompaniesToXlsx } from './excelExporter.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Cancellation handles for in-flight runs, keyed by job id.
 *
 * A background run has no request to abandon, so this map is the only way to
 * reach one after it has started. The entry is created in `enqueue()` — BEFORE
 * the run is scheduled, not inside it — because the gap between "accepted" and
 * "started" is a real window a user can cancel in. Registering on start left
 * that window unguarded: `cancel()` found nothing to abort, and the run then
 * began on a job the API had already reported as cancelled.
 *
 * Entries are removed in `run()`'s `finally`, so a crashed run cannot leave a
 * handle behind, and `cancel()` deliberately does not remove them — a handle is
 * only stale once the run it belongs to has actually stopped.
 *
 * @type {Map<string, { abortController: AbortController }>}
 */
const activeRuns = new Map();

/**
 * Export filenames already handed out in this process.
 *
 * `buildExportFileName()` names a file after the second it was written in, which
 * is unique for one run at a time and NOT unique for several. Two jobs finishing
 * inside the same second produced the same two names, and the second run
 * silently overwrote the first run's files while both job records went on
 * pointing at them.
 *
 * The set remembers names beyond the life of the files they belong to, which is
 * the point: a name is retired for the process, so a reservation cannot be
 * reissued even if the file it named is deleted mid-run.
 *
 * @type {Set<string>}
 */
const reservedExportNames = new Set();

/** Counters the job carries while it runs. Same shape as the pipeline summary. */
const EMPTY_SUMMARY = Object.freeze({
  discovered: 0,
  processed: 0,
  exported: 0,
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
 * Companies processed against companies discovered — the work done over the
 * work there is. Nothing else, and deliberately nothing about the mode: both
 * modes open every company, so a bar that moved differently between them would
 * be reporting a difference that does not exist in the run.
 *
 * It used to blend in `emailsFound / target`, because a run could end early on
 * a target. None can now, so the single ratio rises smoothly and arrives at
 * 100% exactly when the last company has been checked.
 *
 * Before discovery lands, `discovered` is 0 and so is the bar — which is
 * truthful: nothing is known about the size of the run yet.
 *
 * @param {typeof EMPTY_SUMMARY} summary
 * @returns {number} 0–100
 */
export function toProgress(summary) {
  if (!summary.discovered) return 0;
  return Math.min(100, Math.round((summary.processed / summary.discovered) * 100));
}

/**
 * The sentence a finished run is described by.
 *
 * A completed run has always reached the end of the source, so the message has
 * one job the counters cannot do: say what the mode did to the file. "84 checked
 * and 84 exported" and "84 checked, 31 exported" are the same successful run
 * under different modes, and an operator who reads only the second number needs
 * to be told which one they asked for.
 *
 * It takes no `stopReason`. A cancelled run never reaches here — it returns
 * without writing, leaving the record `jobService.cancel()` already wrote — so
 * the only reason left is the source running out, and a parameter that can hold
 * exactly one value is a parameter that will eventually be passed the wrong
 * thing.
 *
 * @param {typeof EMPTY_SUMMARY} summary
 * @param {import('./scrapingPipeline.service.js').ScrapingMode} mode
 * @returns {string}
 */
export function completionMessage(summary, mode) {
  const checked = quantity(summary.processed, 'company', 'companies');
  const exported = quantity(summary.exported, 'company', 'companies');

  if (toScrapingMode(mode) === SCRAPING_MODE.WITH_EMAIL) {
    return (
      `Hipages has no more companies. ${checked} ` +
      `${summary.processed === 1 ? 'was' : 'were'} checked and ${exported} with an email ` +
      `${summary.exported === 1 ? 'was' : 'were'} exported.`
    );
  }

  return (
    `Hipages has no more companies. ${checked} ` +
    `${summary.processed === 1 ? 'was' : 'were'} checked and ${exported} ` +
    `${summary.exported === 1 ? 'was' : 'were'} exported, ` +
    `${quantity(summary.emailsFound, 'email', 'emails')} found.`
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
    throw ApiError.validation(
      `"${value}" is not a valid URL. Paste a full hipages category address, ` +
        'for example https://hipages.com.au/find/electricians/nsw/sydney',
      { field: 'categoryUrl' },
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ApiError.validation(
      `Category URL must start with http:// or https://, not "${url.protocol}".`,
      { field: 'categoryUrl' },
    );
  }

  return url.href;
}

/**
 * Claims a pair of export filenames that no other run can be handed.
 *
 * Both formats share one base name so a run's two files sit together in the
 * folder — that is unchanged. What is new is that the base is checked against
 * the names already issued in this process AND against the exports directory
 * itself, and suffixed `_2`, `_3` … until it collides with neither.
 *
 * The disk check is what covers a restart: the in-memory set is empty again,
 * but yesterday's file is still there and must not be overwritten by a run that
 * happens to finish at the same second of the same day.
 *
 * The common case — no concurrent run, no same-second collision — returns
 * exactly the name the old code produced, so a normal run's files are named as
 * they always were.
 *
 * Exported for the same reason `toProgress()` and `completionMessage()` are:
 * it is a pure-enough decision with a rule worth pinning down, and the only
 * other way to observe a collision is to get two real runs to finish in the
 * same second on purpose.
 *
 * @param {Date} now
 * @returns {{ csv: string, xlsx: string }}
 */
export function reserveExportNames(now) {
  const dir = config.paths.exports;

  const taken = (name) => reservedExportNames.has(name) || fs.existsSync(path.join(dir, name));

  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? '' : `_${attempt}`;
    // Built from the same stamp every time; only the discriminator moves, so
    // the two formats always agree on the base name.
    const csv = buildExportFileName(now, 'csv').replace(/\.csv$/, `${suffix}.csv`);
    const xlsx = buildExportFileName(now, 'xlsx').replace(/\.xlsx$/, `${suffix}.xlsx`);

    if (!taken(csv) && !taken(xlsx)) {
      reservedExportNames.add(csv);
      reservedExportNames.add(xlsx);
      if (attempt > 1) logger.info('Export name collided — using a suffixed name', { csv, xlsx });
      return { csv, xlsx };
    }
  }
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
    // Registered NOW, synchronously, so the job is cancellable from the instant
    // the API reports it accepted. Creating it inside the scheduled callback
    // left a window — short, but reliably hit by a client that cancels straight
    // after starting — where `cancel()` had nothing to abort and the run went on
    // to scrape a job that was already `cancelled`.
    activeRuns.set(job.id, { abortController: new AbortController() });

    setImmediate(() => {
      // `run()` records its own failures on the job; this catch is the guard
      // against a bug INSIDE that recording. Nothing awaits this promise, so an
      // unhandled rejection here would take the process down with it.
      this.run(job, jobRepository).catch((error) => {
        logger.error('Background run threw after recording its own failure', {
          jobId: job.id,
          message: error?.message,
        });
        // The handle is removed in `run()`'s own `finally`; this is the path
        // where that `finally` itself could not run. Leaving the entry would
        // make a dead job look cancellable forever.
        activeRuns.delete(job.id);
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

    // `enqueue()` registered the handle; a direct caller (a test, a CLI) may not
    // have, so one is created on demand rather than assumed.
    const controller =
      activeRuns.get(job.id)?.abortController ??
      activeRuns.set(job.id, { abortController: new AbortController() }).get(job.id)
        .abortController;

    /**
     * The gate between "accepted" and "started".
     *
     * Between `enqueue()` and this callback the job can have been cancelled or
     * deleted, and neither leaves anything for the run to do. Returning here —
     * before the status is written, before a browser is launched — is what makes
     * "a cancelled job never becomes completed" true by construction rather than
     * by the terminal guard catching it several minutes later.
     *
     * The record is re-read rather than trusted from the closure: `job` is the
     * snapshot taken when the job was created, and everything interesting has
     * happened to it since.
     */
    const current = jobRepository.findById(job.id);

    if (!current) {
      logger.info('Job disappeared before its run started — nothing to do', { jobId: job.id });
      activeRuns.delete(job.id);
      return null;
    }

    if (TERMINAL_JOB_STATUSES.includes(current.status) || controller.signal.aborted) {
      logger.info('Job was already finished before its run started — not running', {
        jobId: job.id,
        status: current.status,
      });
      activeRuns.delete(job.id);
      return current;
    }

    logger.info('Job started', { jobId: job.id, sourceId: job.sourceId, params });

    /**
     * The one choice the operator made.
     *
     * Normalised through the pipeline's own `toScrapingMode()` rather than read
     * raw, so the runner's wording and the pipeline's filtering cannot form two
     * different opinions about what an absent or unrecognised value means.
     */
    const mode = toScrapingMode(params.scrapingMode);

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
        // What the run produces is rows in a file, so that is what a result
        // count is. Under `all` it tracks companies checked; under `with-email`
        // it tracks companies with an address — one field, one meaning, and the
        // mode is what changes the number.
        resultCount: live.exported,
        progress: toProgress(live),
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
      // A category and a mode are the whole request. There is no size to pass:
      // the run is the whole category, and the mode never shortens it.
      const { records, summary, stopReason } = await runPipeline(
        {
          categoryUrl: requireCategoryUrl(params.categoryUrl),
          mode,
        },
        {
          signal: controller.signal,

          onDiscovered: ({ discovered }) => {
            live = { ...live, discovered };
            publish(
              `Running — ${quantity(discovered, 'company', 'companies')} available to check.`,
            );
          },

          // One call per company checked, in both modes, whether or not that
          // company will be exported. The record is ignored here: the counters
          // already say everything the job record publishes, and the rows
          // themselves go to the exporters at the end.
          onProgress: (snapshot) => {
            live = snapshot;
            publish(
              `Running — ${quantity(live.processed, 'company', 'companies')} checked, ` +
                `${quantity(live.exported, 'company', 'companies')} to export.`,
            );
          },
        },
      );

      // A cancelled run writes nothing at all. `jobService.cancel()` already
      // wrote the terminal record — with the counters this run had published up
      // to that moment — and the repository would refuse this write anyway.
      // Returning before the exporters is what makes "no export is generated for
      // a cancelled job" a property of the code rather than of the guard.
      if (controller.signal.aborted) {
        logger.warn('Run stopped by cancellation — no export written', {
          jobId: job.id,
          checked: summary.processed,
        });
        return jobRepository.findById(job.id);
      }

      // Both formats come from the same records and share one timestamp, so a
      // run's two files sit side by side in the exports folder under one name.
      // The names are reserved rather than derived, so two runs finishing in the
      // same second cannot be handed the same pair.
      const stamp = new Date();
      const names = reserveExportNames(stamp);
      const csv = await exportCompaniesToCsv(records, { now: stamp, fileName: names.csv });
      const xlsx = await exportCompaniesToXlsx(records, {
        now: stamp,
        fileName: names.xlsx,
        summary,
        categoryUrl: params.categoryUrl,
      });

      logger.info('Job completed', {
        jobId: job.id,
        stopReason,
        mode,
        checked: summary.processed,
        exported: summary.exported,
        emailsFound: summary.emailsFound,
        csv: csv.fileName,
        xlsx: xlsx.fileName,
      });

      return jobRepository.update(job.id, {
        status: JOB_STATUS.COMPLETED,
        // 100 explicitly. `toProgress()` already lands there when every company
        // was checked, but a run whose discovery count and processed count
        // disagree for any reason is still a finished job, and a bar left short
        // of the end would report it as the failure it is not.
        progress: 100,
        resultCount: summary.exported,
        message: completionMessage(summary, mode),
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
      // A cancelled run reaches here too, because aborting mid-company surfaces
      // as a thrown error. It is not a failure and writes nothing — same reason
      // as the successful-but-cancelled path above.
      if (controller.signal.aborted) {
        logger.warn('Run threw while cancelling — treated as cancelled, not failed', {
          jobId: job.id,
          message: error?.message,
        });
        return jobRepository.findById(job.id);
      }

      logger.error('Job failed', { jobId: job.id, message: error?.message });

      // `error.message` is not guaranteed to exist — a rejection can carry a
      // string, or nothing at all. A job that failed must still say why, and
      // `undefined` in the error field reads as "no error".
      return jobRepository.update(job.id, {
        status: JOB_STATUS.FAILED,
        message: 'Run failed.',
        error: error?.message ?? String(error ?? 'Unknown error'),
        summary: { ...live },
        finishedAt: new Date().toISOString(),
      });
    } finally {
      // The only place a handle is retired. Runs on every path out — success,
      // failure, cancellation, and a throw from any of the writes above.
      activeRuns.delete(job.id);
    }
  },


  /**
   * Signals a scheduled or running job to stop.
   *
   * The handle exists from `enqueue()` onwards, so this reaches a job that has
   * not started yet as surely as one halfway through a category: the run checks
   * the same signal before it begins and between every company.
   *
   * It does NOT remove the entry. The handle describes a run that is still
   * winding down — finishing the company it is on, closing its browser — and
   * `run()`'s `finally` is the one place that retires it. Removing it here made
   * `activeRuns` claim the run had stopped while it was still holding a browser
   * open, and made a second cancel a silent no-op.
   *
   * Idempotent: aborting an already-aborted controller does nothing, so a user
   * clicking Cancel twice is not a special case.
   *
   * @param {string} jobId
   * @returns {boolean} whether a run was there to signal
   */
  cancel(jobId) {
    const run = activeRuns.get(jobId);
    if (!run) return false;
    run.abortController.abort();
    return true;
  },

  /** @param {string} status */
  isTerminal(status) {
    return TERMINAL_JOB_STATUSES.includes(status);
  },
};

export default scrapeRunner;
