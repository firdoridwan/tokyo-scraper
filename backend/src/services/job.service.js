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
        throw ApiError.validation(`Missing required parameter "${field.name}"`, {
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
   * Creates a job and runs it.
   *
   * Awaits the run rather than returning a queued record: with no queue and no
   * polling, the response IS the completion notice, so the caller receives the
   * finished job — status, company count and export filename included.
   *
   * @param {{ sourceId: string, params?: Record<string, unknown> }} payload
   */
  async create({ sourceId, params }) {
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

    return scrapeRunner.run(job, jobRepository);
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
   * @param {string} id
   */
  cancel(id) {
    const job = this.getById(id);

    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
      throw ApiError.conflict(`Job is already ${job.status} and cannot be cancelled`, {
        jobId: id,
        status: job.status,
      });
    }

    scrapeRunner.cancel(id);

    const now = new Date().toISOString();
    logger.info('Job cancelled', { jobId: id });

    return jobRepository.update(id, {
      status: JOB_STATUS.CANCELLED,
      message: 'Cancelled by user.',
      finishedAt: now,
    });
  },

  /**
   * Deletes a job together with its extracted rows.
   * @param {string} id
   */
  remove(id) {
    this.getById(id);
    const removedResults = resultRepository.removeByJob(id);
    jobRepository.remove(id);
    logger.info('Job deleted', { jobId: id, removedResults });
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
