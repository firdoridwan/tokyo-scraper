/**
 * Minimal levelled logger.
 *
 * Deliberately dependency-free and tiny: the whole app logs through this one
 * module, so swapping in pino/winston later means rewriting this file only.
 */
import { config } from '../config/env.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

const threshold = LEVELS[config.logging.level] ?? LEVELS.info;

function write(level, message, context) {
  if (LEVELS[level] > threshold) return;

  const timestamp = new Date().toISOString();

  if (!config.logging.pretty) {
    // Structured single-line JSON — friendly to log collectors.
    process.stdout.write(
      `${JSON.stringify({ timestamp, level, message, ...context })}\n`,
    );
    return;
  }

  const label = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const suffix =
    context && Object.keys(context).length > 0
      ? ` ${DIM}${JSON.stringify(context)}${RESET}`
      : '';
  process.stdout.write(`${DIM}${timestamp}${RESET} ${label} ${message}${suffix}\n`);
}

export const logger = {
  error: (message, context) => write('error', message, context),
  warn: (message, context) => write('warn', message, context),
  info: (message, context) => write('info', message, context),
  debug: (message, context) => write('debug', message, context),

  /** Returns a logger that stamps every entry with the given context. */
  child(boundContext) {
    return {
      error: (message, context) => write('error', message, { ...boundContext, ...context }),
      warn: (message, context) => write('warn', message, { ...boundContext, ...context }),
      info: (message, context) => write('info', message, { ...boundContext, ...context }),
      debug: (message, context) => write('debug', message, { ...boundContext, ...context }),
      child: (extra) => logger.child({ ...boundContext, ...extra }),
    };
  },
};

export default logger;
