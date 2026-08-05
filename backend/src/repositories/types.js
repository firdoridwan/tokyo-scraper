/**
 * Repository interfaces.
 *
 * Any driver (memory today, SQLite next) must satisfy these signatures. Written
 * as JSDoc rather than TypeScript to keep the toolchain plain Node — the
 * contract is still explicit and editor-checked.
 */

/**
 * @typedef {object} Job
 * @property {string} id
 * @property {string} sourceId
 * @property {Record<string, unknown>} params
 * @property {'queued'|'running'|'completed'|'failed'|'cancelled'} status
 * @property {number} progress          0–100. Completion of the run, which ends
 *   at either the email target or the end of the source — whichever arrives
 *   first. A finished job is always 100, including one that exhausted the
 *   source short of its target.
 * @property {number} resultCount       Emails collected, which is also the
 *   number of rows in the export
 * @property {string|null} message      Last human-readable status line
 * @property {string|null} error
 * @property {string} createdAt         ISO-8601
 * @property {string} updatedAt         ISO-8601
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 * @property {{
 *   discovered: number,
 *   processed: number,
 *   skipped: number,
 *   failed: number,
 *   emailsFound: number
 * }} [summary]
 *   Live counters, mirrored from the pipeline. Present from the moment a run
 *   starts and updated after every company checked, so polling this record
 *   shows a run in motion.
 *
 *   `emailsFound` is the goal of the run and the row count of the export;
 *   `processed` is companies checked; `skipped` is companies dropped for having
 *   no website or no email; `discovered` is the size of the pool the source
 *   offered. `processed = emailsFound + skipped + failed`.
 *
 *   The UI surfaces three of these — emails found, companies checked, failed.
 *   The rest are carried because the exported workbook's Summary sheet is built
 *   from the same shape and its format is fixed.
 * @property {{
 *   fileName: string,
 *   rowsWritten: number,
 *   bytes: number,
 *   files: { csv: string, xlsx: string }
 * }} [export]
 *   The files this run wrote. Present only on a completed job; it is what
 *   `GET /results/export?jobId=…&format=…` resolves the download from.
 *   `fileName` is the CSV, kept as the default-format field.
 */

/**
 * @typedef {object} Result
 * @property {string} id
 * @property {string} jobId
 * @property {string} sourceId
 * @property {string} businessName
 * @property {Record<string, unknown>} data  Source-specific extracted fields
 * @property {string} createdAt
 */

/**
 * @typedef {object} ListQuery
 * @property {number} page
 * @property {number} pageSize
 * @property {string} [status]
 * @property {string} [sourceId]
 * @property {string} [jobId]
 * @property {string} [search]
 */

/**
 * @template T
 * @typedef {{ items: T[], total: number }} Page
 */

/**
 * @typedef {object} JobRepository
 * @property {(job: Job) => Job} create
 * @property {(id: string) => Job|null} findById
 * @property {(query: ListQuery) => Page<Job>} findMany
 * @property {(id: string, patch: Partial<Job>) => Job|null} update
 * @property {(id: string) => boolean} remove
 * @property {() => { total: number, byStatus: Record<string, number> }} stats
 */

/**
 * @typedef {object} ResultRepository
 * @property {(result: Result) => Result} create
 * @property {(results: Result[]) => number} createMany
 * @property {(query: ListQuery) => Page<Result>} findMany
 * @property {(jobId: string) => number} countByJob
 * @property {(jobId: string) => number} removeByJob
 * @property {() => { total: number }} stats
 */

export {};
