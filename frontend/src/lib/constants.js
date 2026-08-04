/**
 * Client-side mirror of the backend's domain constants
 * (`backend/src/config/constants.js`). Kept as a plain module so status
 * handling is declarative rather than a chain of conditionals in components.
 */

export const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/**
 * Presentation metadata per status. `tone` maps to a StatusBadge variant so a
 * new status needs one entry here and nothing else.
 */
export const JOB_STATUS_META = Object.freeze({
  [JOB_STATUS.QUEUED]: { label: 'Queued', tone: 'neutral' },
  [JOB_STATUS.RUNNING]: { label: 'Running', tone: 'info' },
  [JOB_STATUS.COMPLETED]: { label: 'Completed', tone: 'success' },
  [JOB_STATUS.FAILED]: { label: 'Failed', tone: 'error' },
  [JOB_STATUS.CANCELLED]: { label: 'Cancelled', tone: 'muted' },
});

export const JOB_STATUS_OPTIONS = Object.entries(JOB_STATUS_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const DEFAULT_PAGE_SIZE = 25;

export const APP = Object.freeze({
  name: 'Tokyo Scraper',
  tagline: 'Business directory extraction',
  version: '0.1.0',
});
