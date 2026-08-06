/**
 * Result service — read + export access to extracted rows.
 *
 * The export path resolves a job's already-written CSV. It does not generate
 * one: the file is produced during the run by `csvExporter.service.js`, so a
 * download is a lookup, and re-running a scrape is never a side effect of
 * clicking Download.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_FORMAT } from '../config/constants.js';
import { config } from '../config/env.js';
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
   * Locates a file a completed job wrote, for download.
   *
   * Returns a path rather than a stream so the controller can hand it to
   * `res.download()` and let Express own the headers — including the content
   * type, which it derives from the extension.
   *
   * A run writes both formats, so this is a lookup by format, never a
   * conversion: asking for `xlsx` returns the workbook that run produced.
   *
   * The filename is resolved from the job record and then `basename`d before it
   * is joined to the exports directory. The job store is trusted today, but a
   * value that becomes a filesystem path must not be able to carry `../` — that
   * is one repository change away from being a real hole.
   *
   * @param {{ jobId?: string, format: string }} options
   * @returns {{ filePath: string, fileName: string }}
   */
  export({ jobId, format }) {
    if (format !== EXPORT_FORMAT.CSV && format !== EXPORT_FORMAT.XLSX) {
      throw ApiError.notImplemented(`Export format "${format}" is not implemented.`, {
        supported: [EXPORT_FORMAT.CSV, EXPORT_FORMAT.XLSX],
      });
    }

    if (!jobId) {
      throw ApiError.badRequest('A jobId is required — exports belong to a run.', {
        example: '/api/v1/results/export?jobId=<id>&format=xlsx',
      });
    }

    const job = jobService.getById(jobId);
    // `export.fileName` is the CSV, kept for jobs recorded before the workbook
    // existed; `export.files` carries every format a run wrote.
    const fileName =
      job.export?.files?.[format] ?? (format === EXPORT_FORMAT.CSV ? job.export?.fileName : null);

    if (!fileName) {
      // Only a completed run writes files, so the status is the whole
      // explanation — a cancelled or failed job has nothing to download and
      // never will.
      throw ApiError.notFound(
        `This job wrote no ${format.toUpperCase()} file — it is ${job.status}. ` +
          'Only completed runs produce a download.',
        { jobId, status: job.status, format },
      );
    }

    const filePath = path.join(config.paths.exports, path.basename(fileName));

    if (!fs.existsSync(filePath)) {
      throw ApiError.notFound(
        `The export file "${fileName}" is no longer on disk. ` +
          'It was moved or deleted after the run; start the scrape again to recreate it.',
        { jobId, fileName, format },
      );
    }

    return { filePath, fileName };
  },
};

export default resultService;
