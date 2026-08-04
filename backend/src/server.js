/**
 * Process entry point.
 *
 * Owns everything the Express app should not: filesystem bootstrap, the HTTP
 * listener, graceful shutdown, and last-resort crash handlers.
 */
import fs from 'node:fs';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';

/** Runtime directories are created on boot so nothing downstream has to check. */
function ensureRuntimeDirectories() {
  for (const dir of [config.paths.data, config.paths.exports, config.paths.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function start() {
  ensureRuntimeDirectories();

  const app = createApp();
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info('Tokyo Scraper API listening', {
      url: `http://${config.server.host}:${config.server.port}`,
      api: `${config.server.apiPrefix}/v1`,
      env: config.env,
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.server.port} is already in use`, { port: config.server.port });
      process.exit(1);
    }
    throw error;
  });

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Don't hang forever on lingering connections.
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', { message: error.message, stack: error.stack });
    process.exit(1);
  });

  return server;
}

start();
