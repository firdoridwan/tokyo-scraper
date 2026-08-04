import { logger } from '../utils/logger.js';

/**
 * Logs one line per completed request. Uses the `finish` event so the status
 * code and duration are real rather than assumed.
 */
export function requestLogger(req, res, next) {
  res.on('finish', () => {
    const durationMs = req.startedAt
      ? Number(process.hrtime.bigint() - req.startedAt) / 1_000_000
      : undefined;

    const context = {
      requestId: req.id,
      status: res.statusCode,
      durationMs: durationMs !== undefined ? Number(durationMs.toFixed(1)) : undefined,
    };

    const message = `${req.method} ${req.originalUrl}`;
    if (res.statusCode >= 500) logger.error(message, context);
    else if (res.statusCode >= 400) logger.warn(message, context);
    else logger.info(message, context);
  });

  next();
}

export default requestLogger;
