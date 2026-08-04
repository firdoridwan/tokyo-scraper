import { ERROR_CODE } from '../config/constants.js';

/**
 * Operational error carrying an HTTP status and a machine-readable code.
 *
 * Anything thrown that is *not* an ApiError is treated as a programmer bug by
 * the error handler: it is logged with a stack trace and reported to the client
 * as a generic 500 with no internals leaked.
 */
export class ApiError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message Human-readable message, safe to show to the user
   * @param {object} [options]
   * @param {string} [options.code]    Machine-readable code from ERROR_CODE
   * @param {unknown} [options.details] Structured extra context (e.g. field errors)
   * @param {Error}  [options.cause]   Underlying error, kept for logging only
   */
  constructor(status, message, { code, details, cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? ERROR_CODE.INTERNAL;
    this.details = details;
    /** Marks the error as expected — safe to surface verbatim. */
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, { code: ERROR_CODE.BAD_REQUEST, details });
  }

  static validation(message = 'Validation failed', details) {
    return new ApiError(422, message, { code: ERROR_CODE.VALIDATION_ERROR, details });
  }

  static notFound(message = 'Resource not found', details) {
    return new ApiError(404, message, { code: ERROR_CODE.NOT_FOUND, details });
  }

  static conflict(message = 'Conflicting state', details) {
    return new ApiError(409, message, { code: ERROR_CODE.CONFLICT, details });
  }

  static notImplemented(message = 'Not implemented yet', details) {
    return new ApiError(501, message, { code: ERROR_CODE.NOT_IMPLEMENTED, details });
  }

  static internal(message = 'Internal server error', details) {
    return new ApiError(500, message, { code: ERROR_CODE.INTERNAL, details });
  }
}

export default ApiError;
