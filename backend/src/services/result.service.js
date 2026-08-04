/**
 * Result service — read + export access to extracted rows.
 *
 * The export path is intentionally stubbed: writing CSV is a separate
 * milestone and would be dishonest to fake.
 */
import { EXPORT_FORMAT } from '../config/constants.js';
import { resultRepository } from '../repositories/index.js';
import { jobService } from './job.service.js';
import { ApiError } from '../utils/ApiError.js';

export const resultService = {
  /** @param {import('../repositories/types.js').ListQuery} query */
  list(query) {
    return resultRepository.findMany(query);
  },

  /**
   * Rows belonging to one job. Validates the job first so a bad id is a clear
   * 404 rather than an empty list.
   * @param {string} jobId
   * @param {import('../repositories/types.js').ListQuery} query
   */
  listByJob(jobId, query) {
    jobService.getById(jobId);
    return resultRepository.findMany({ ...query, jobId });
  },

  /**
   * Export. Not implemented — `csv-writer` is installed and
   * `config.paths.exports` is configured, ready for the export milestone.
   *
   * @param {{ jobId?: string, format: string }} options
   */
  export({ jobId, format }) {
    if (!Object.values(EXPORT_FORMAT).includes(format)) {
      throw ApiError.badRequest(`Unsupported export format "${format}"`, {
        supported: Object.values(EXPORT_FORMAT),
      });
    }

    throw ApiError.notImplemented('Export is not implemented yet.', { jobId, format });
  },
};

export default resultService;
