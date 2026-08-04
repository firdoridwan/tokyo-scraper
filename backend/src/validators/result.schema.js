import { z } from 'zod';
import { EXPORT_FORMAT } from '../config/constants.js';
import { paginationSchema, sourceIdSchema } from './common.schema.js';

export const listResultsSchema = paginationSchema.extend({
  jobId: z.string().min(1).optional(),
  sourceId: sourceIdSchema.optional(),
  search: z.string().max(200).optional(),
});

export const exportResultsSchema = z.object({
  jobId: z.string().min(1).optional(),
  format: z.enum(Object.values(EXPORT_FORMAT)).default(EXPORT_FORMAT.CSV),
});
