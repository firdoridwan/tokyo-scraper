import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { sendError } from '../utils/apiResponse.js';
import { ERROR_CODE } from '../config/constants.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Single exit point for every failure in the API.
 *
 * Known (operational) errors are surfaced verbatim. Anything else is a bug:
 * logged with its stack, returned as a generic 500. No internal detail ever
 * leaks to the client in production.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity (4 args).
export function errorHandler(err, req, res, _next) {
  let normalized = err;

  if (err instanceof ZodError) {
    normalized = ApiError.validation('Validation failed', {
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  } else if (err?.type === 'entity.parse.failed') {
    normalized = ApiError.badRequest('Request body is not valid JSON');
  } else if (!(err instanceof ApiError)) {
    normalized = new ApiError(500, 'Internal server error', {
      code: ERROR_CODE.INTERNAL,
      cause: err,
    });
    normalized.isOperational = false;
  }

  const logContext = {
    requestId: req.id,
    status: normalized.status,
    code: normalized.code,
    path: req.originalUrl,
  };

  if (normalized.isOperational) {
    logger.warn(normalized.message, logContext);
  } else {
    logger.error(err?.message ?? 'Unhandled error', {
      ...logContext,
      stack: err?.stack,
    });
  }

  return sendError(res, {
    status: normalized.status,
    code: normalized.code,
    message: normalized.message,
    details: config.isProduction && !normalized.isOperational ? undefined : normalized.details,
  });
}

export default errorHandler;
