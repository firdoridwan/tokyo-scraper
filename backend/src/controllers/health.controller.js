import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/env.js';
import { repositories } from '../repositories/index.js';
import { scrapeRunner } from '../services/scrapeRunner.service.js';
import { listSources } from '../scrapers/registry.js';

/**
 * Health & capability probe.
 *
 * Doubles as the frontend's connection check — the shell shows "API online"
 * based on this endpoint, and reports which subsystems are actually live.
 */
export const healthController = {
  check: asyncHandler(async (req, res) =>
    sendSuccess(res, {
      status: 'ok',
      service: 'tokyo-scraper-api',
      version: '0.1.0',
      environment: config.env,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      subsystems: {
        persistence: { driver: repositories.driver, ready: true },
        scrapeEngine: { ready: scrapeRunner.isEngineAvailable },
        sources: {
          registered: listSources().length,
          implemented: listSources().filter((source) => source.implemented).length,
        },
      },
    }),
  ),
};

export default healthController;
