/**
 * Express application assembly.
 *
 * Builds and returns the app but never listens — that separation lets tests
 * import the app directly and keeps process concerns in `server.js`.
 *
 * Middleware order is deliberate: context -> security -> parsing -> logging ->
 * routes -> 404 -> error handler.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import { config } from './config/env.js';
import apiRouter from './api/index.js';
import { requestContext } from './middleware/requestContext.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  // Behind a reverse proxy in production, trust X-Forwarded-* for correct IPs.
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(
    helmet({
      // The API serves JSON only; CSP belongs to the frontend host.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: config.server.corsOrigins,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestLogger);

  app.use(config.server.apiPrefix, apiRouter);

  // Root ping — confirms the process is reachable without knowing the prefix.
  app.get('/', (req, res) =>
    res.json({
      success: true,
      data: { name: 'Tokyo Scraper API', api: `${config.server.apiPrefix}/v1` },
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
