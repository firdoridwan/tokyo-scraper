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
 * @property {number} progress          0–100
 * @property {number} resultCount
 * @property {string|null} message      Last human-readable status line
 * @property {string|null} error
 * @property {string} createdAt         ISO-8601
 * @property {string} updatedAt         ISO-8601
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 * @property {object} [summary]         Pipeline counts, set when a run completes
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
