import { createRequestId } from '../utils/id.js';

/**
 * Attaches a correlation id to every request and echoes it back as
 * `X-Request-Id`. Long-running scrape jobs will produce interleaved logs;
 * this is what makes a single request traceable through them.
 */
export function requestContext(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && incoming.length <= 64 ? incoming : createRequestId();
  req.startedAt = process.hrtime.bigint();
  res.set('X-Request-Id', req.id);
  next();
}

export default requestContext;
