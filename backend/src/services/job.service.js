/**
 * Job service — all business rules for scrape jobs.
 *
 * Controllers stay thin (HTTP in, HTTP out); every decision about what a job
 * *is* and which transitions are legal lives here.
 */
import { JOB_STATUS, TERMINAL_JOB_STATUSES } from '../config/constants.js';
import { jobRepository, resultRepository } from '../repositories/index.js';
import { requireSource } from '../scrapers/registry.js';
import { scrapeRunner } from './scrapeRunner.service.js';
import { ApiError } from '../utils/ApiError.js';
import { createJobId } from '../utils/id.js';
import { logger } from '../utils/logger.js';

/**
 * Applies a source's declared defaults to the submitted parameters and drops
 * anything the source does not declare — the descriptor is the contract.
 *
 * @param {import('../scrapers/types.js').SourceDescriptor} source
 * @param {Record<string, unknown>} params
 */
function normalizeParams(source, params = {}) {
  const normalized = {};

  for (const field of source.fields) {
    const value = params[field.name];

    if (value === undefined || value === '') {
      if (field.defaultValue !== undefined) normalized[field.name] = field.defaultValue;
      else if (field.required) {
        // Named by its label, not its key. Whoever reads this filled in a form
        // that says "Category URL"; `categoryUrl` is what the code calls it and
        // does not say which box to go back to. The key is still in
        // `details.field` for anything reading this programmatically.
        throw ApiError.validation(`${field.label} is required.`, {
          field: field.name,
          label: field.label,
        });
      }
      continue;
    }

    normalized[field.name] =
      field.type === 'number' ? Number(value) : typeof value === 'string' ? value.trim() : value;
  }

  return normalized;
}

export const jobService = {
  /**
   * Creates a job and schedules it.
   *
   * Returns the moment the record exists, still `queued`. Everything that can
   * reject a request — unknown source, missing or malformed parameters — has
   * already happened by then, so an accepted job is a job that will actually
   * run. The work itself is handed to the runner and proceeds in the background.
   *
   * @param {{ sourceId: string, params?: Record<string, unknown> }} payload
   */
  create({ sourceId, params }) {
    const source = requireSource(sourceId);
    const normalizedParams = normalizeParams(source, params);
    const now = new Date().toISOString();

    /** @type {import('../repositories/types.js').Job} */
    const job = {
      id: createJobId(),
      sourceId: source.id,
      sourceName: source.name,
      params: normalizedParams,
      status: JOB_STATUS.QUEUED,
      progress: 0,
      resultCount: 0,
      message: 'Job created.',
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };

    jobRepository.create(job);
    logger.info('Job created', { jobId: job.id, sourceId: job.sourceId });

    return scrapeRunner.enqueue(job, jobRepository);
  },

  /** @param {import('../repositories/types.js').ListQuery} query */
  list(query) {
    return jobRepository.findMany(query);
  },

  /** @param {string} id */
  getById(id) {
    const job = jobRepository.findById(id);
    if (!job) throw ApiError.notFound(`Job "${id}" not found`);
    return job;
  },

  /**
   * Cancels a job. Terminal jobs are a 409, not a silent no-op — the caller
   * asked for a state change that cannot happen.
   *
   * This is the ONLY writer of the `cancelled` state, and it writes it once.
   * The run that is being cancelled adds nothing afterwards: it stops, closes
   * its browser, and returns without touching the record. Two writers for one
   * ending is how a job that the API had already reported as cancelled went on
   * changing for another half-minute.
   *
   * Writing it here rather than when the run notices also means the response to
   * `POST /jobs/:id/cancel` is already the final record — the client does not
   * have to poll to find out whether the cancellation took.
   *
   * The counters come off the record the run has been publishing, so the
   * message still says how far the run got. They are a snapshot from the moment
   * cancellation was requested, which is at most one company behind where the
   * run actually stopped.
   *
   * @param {string} id
   */
  cancel(id) {
    const job = this.getById(id);

    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
      throw ApiError.conflict(
        `This job has already finished (${job.status}) and can no longer be cancelled.`,
        { jobId: id, status: job.status },
      );
    }

    // Signalled before the record is written, so the run cannot squeeze another
    // company's progress write in between the two.
    const signalled = scrapeRunner.cancel(id);

    const summary = job.summary ?? {};
    const checked = summary.processed ?? 0;
    const found = summary.emailsFound ?? 0;

    logger.info('Job cancelled', { jobId: id, signalled, checked });

    return jobRepository.update(id, {
      status: JOB_STATUS.CANCELLED,
      message:
        checked > 0
          ? `Cancelled after ${checked} ${checked === 1 ? 'company' : 'companies'} checked, ` +
            `${found} ${found === 1 ? 'email' : 'emails'} found.`
          : 'Cancelled by user.',
      // No export is written for a cancelled run, so nothing was produced. The
      // counter reports what WOULD have qualified — the honest number to show
      // beside a run whose files never existed.
      resultCount: summary.exported ?? 0,
      finishedAt: new Date().toISOString(),
    });
  },

  /**
   * Deletes a job together with its extracted rows.
   *
   * A running job is signalled to stop first. Deleting the record without it
   * left the run going: it kept a browser open and kept scraping for the rest of
   * the category, publishing progress onto a job that no longer existed. The
   * record was gone, so nothing showed it — which is exactly what makes an
   * orphaned browser hard to notice.
   *
   * @param {string} id
   */
  remove(id) {
    this.getById(id);

    const signalled = scrapeRunner.cancel(id);
    const removedResults = resultRepository.removeByJob(id);
    jobRepository.remove(id);

    logger.info('Job deleted', { jobId: id, removedResults, runSignalled: signalled });
    return { id, removedResults };
  },

  /** Aggregate counters for the dashboard. */
  stats() {
    const jobStats = jobRepository.stats();
    const resultStats = resultRepository.stats();

    return {
      jobs: {
        total: jobStats.total,
        queued: jobStats.byStatus[JOB_STATUS.QUEUED] ?? 0,
        running: jobStats.byStatus[JOB_STATUS.RUNNING] ?? 0,
        completed: jobStats.byStatus[JOB_STATUS.COMPLETED] ?? 0,
        failed: jobStats.byStatus[JOB_STATUS.FAILED] ?? 0,
        cancelled: jobStats.byStatus[JOB_STATUS.CANCELLED] ?? 0,
      },
      results: { total: resultStats.total },
      engine: { available: scrapeRunner.isEngineAvailable },
    };
  },
};

export default jobService;
