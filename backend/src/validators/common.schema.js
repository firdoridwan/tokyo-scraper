import { z } from 'zod';
import { PAGINATION } from '../config/constants.js';

/**
 * Reusable schema fragments.
 *
 * Query-string values always arrive as strings, so numeric fields use `coerce`
 * and carry their own defaults — controllers then receive real numbers.
 */

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
});

export const idParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const sourceIdSchema = z
  .string()
  .min(1, 'sourceId is required')
  .regex(/^[a-z0-9-]+$/, 'sourceId must be lowercase alphanumeric with dashes');
