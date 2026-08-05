/**
 * Domain constants shared across the backend.
 *
 * These values are part of the API contract — the frontend mirrors them in
 * `frontend/src/lib/constants.js`. Change them in both places deliberately.
 */

/** Lifecycle of a scrape job. */
export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const JOB_STATUSES = Object.freeze(Object.values(JOB_STATUS));

/** Terminal states — a job in one of these will never change again. */
export const TERMINAL_JOB_STATUSES = Object.freeze([
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
  JOB_STATUS.CANCELLED,
]);

/** Machine-readable error codes returned in the API error envelope. */
export const ERROR_CODE = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE: 'UNPROCESSABLE_ENTITY',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL_SERVER_ERROR',
});

/** Supported export formats. `csv` and `xlsx` are written on every run. */
export const EXPORT_FORMAT = Object.freeze({
  CSV: 'csv',
  XLSX: 'xlsx',
  JSON: 'json',
});

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 200,
});

export const LIMITS = Object.freeze({
  MIN_PAGES: 1,
  MAX_PAGES: 100,
  MAX_QUERY_LENGTH: 120,
});
