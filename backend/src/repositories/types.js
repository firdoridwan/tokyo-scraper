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
 *   `completed`, `failed` and `cancelled` are TERMINAL: a job in one of them can
 *   never be written to again, and the store enforces that rather than trusting
 *   its callers — see `MemoryJobRepository.update()`. Any driver replacing it
 *   owes the same guarantee, because the writers are concurrent: a background
 *   run publishes progress while an HTTP request may finish the same job between
 *   two of those writes.
 * @property {number} progress          0–100. Companies processed over companies
 *   discovered — the work done over the work there is. Never decreases, and a
 *   finished job is always 100.
 * @property {number} resultCount       Rows in the export, i.e. the companies
 *   the run's scraping mode kept. `all` keeps every company that did not error;
 *   `with-email` keeps only those with an address.
 * @property {string|null} message      Last human-readable status line
 * @property {string|null} error
 * @property {string} createdAt         ISO-8601
 * @property {string} updatedAt         ISO-8601
 * @property {string|null} startedAt
 * @property {string|null} finishedAt
 * @property {{
 *   discovered: number,
 *   processed: number,
 *   exported: number,
 *   skipped: number,
 *   failed: number,
 *   emailsFound: number
 * }} [summary]
 *   Live counters, mirrored from the pipeline. Present from the moment a run
 *   starts and updated after every company checked, so polling this record
 *   shows a run in motion. Every counter only ever rises.
 *
 *   `discovered` is the size of the pool the source offered and `processed` is
 *   how many of them the run has decided about; both modes open all of them.
 *   `skipped` is companies that yielded no email, `failed` is companies that
 *   errored, and `processed = emailsFound + skipped + failed`.
 *
 *   `exported` cuts across those buckets rather than joining them — it is the
 *   count the scraping mode decides, and the only figure that differs between
 *   the two modes. It is also the export's row count.
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
