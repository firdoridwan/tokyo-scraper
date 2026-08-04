/**
 * Environment configuration.
 *
 * Single source of truth for every runtime setting. Nothing else in the codebase
 * reads `process.env` directly — that keeps configuration auditable and makes it
 * impossible for a typo'd variable name to silently become `undefined` deep
 * inside a module.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — `backend/src/config` -> up three levels. */
export const ROOT_DIR = path.resolve(__dirname, '../../..');
export const BACKEND_DIR = path.resolve(__dirname, '../..');

// `backend/.env` wins, repo-root `.env` is the shared fallback.
dotenv.config({ path: path.join(BACKEND_DIR, '.env') });
dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const toList = (value, fallback) =>
  value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : fallback;

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT_DIR, process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',

  server: {
    port: toInt(process.env.PORT, 4000),
    host: process.env.HOST ?? '127.0.0.1',
    /** Mount point for the versioned API. Bump the version, not the routes. */
    apiPrefix: process.env.API_PREFIX ?? '/api',
    corsOrigins: toList(process.env.CORS_ORIGINS, [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]),
  },

  paths: {
    root: ROOT_DIR,
    data: DATA_DIR,
    exports: path.join(DATA_DIR, 'exports'),
    logs: path.join(DATA_DIR, 'logs'),
    database: process.env.DATABASE_PATH
      ? path.resolve(ROOT_DIR, process.env.DATABASE_PATH)
      : path.join(DATA_DIR, 'database.sqlite'),
  },

  /**
   * Persistence driver. `memory` is the skeleton default; switching to
   * `sqlite` is the only change needed once the SQLite repositories land.
   */
  persistence: {
    driver: process.env.PERSISTENCE_DRIVER ?? 'memory',
  },

  /** Defaults handed to scraper modules once the engine is implemented. */
  scraper: {
    headless: toBool(process.env.SCRAPER_HEADLESS, true),
    concurrency: toInt(process.env.SCRAPER_CONCURRENCY, 2),
    requestDelayMs: toInt(process.env.SCRAPER_REQUEST_DELAY_MS, 1500),
    navigationTimeoutMs: toInt(process.env.SCRAPER_NAVIGATION_TIMEOUT_MS, 45000),
    maxRetries: toInt(process.env.SCRAPER_MAX_RETRIES, 2),
    userAgent:
      process.env.SCRAPER_USER_AGENT ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  },

  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: toBool(process.env.LOG_PRETTY, process.env.NODE_ENV !== 'production'),
  },
});

export default config;
