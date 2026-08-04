import { z } from 'zod';
import { JOB_STATUSES } from '../config/constants.js';
import { paginationSchema, sourceIdSchema } from './common.schema.js';

/**
 * Job request schemas.
 *
 * `params` is deliberately an open record: each source declares its own fields
 * in its descriptor, and `jobService.normalizeParams` enforces them. Encoding
 * hipages-specific keys here would defeat the multi-source architecture.
 */
export const createJobSchema = z.object({
  sourceId: sourceIdSchema,
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const listJobsSchema = paginationSchema.extend({
  status: z.enum(JOB_STATUSES).optional(),
  sourceId: sourceIdSchema.optional(),
});
