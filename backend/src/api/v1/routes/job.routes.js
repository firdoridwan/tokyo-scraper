import { Router } from 'express';
import { jobController } from '../../../controllers/job.controller.js';
import { validate } from '../../../middleware/validate.js';
import { createJobSchema, listJobsSchema } from '../../../validators/job.schema.js';
import { listResultsSchema } from '../../../validators/result.schema.js';
import { idParamSchema } from '../../../validators/common.schema.js';

const router = Router();

/**
 * POST /api/v1/jobs — the endpoint behind "Start Scraping".
 *
 * Validates, creates and schedules a job, then answers immediately with it in
 * `queued`. The scrape itself runs in the background; callers follow it through
 * `GET /api/v1/jobs/:id` rather than by waiting on this response.
 */
router.post('/', validate({ body: createJobSchema }), jobController.create);

/** GET /api/v1/jobs — paginated, filterable job list. */
router.get('/', validate({ query: listJobsSchema }), jobController.list);

/** GET /api/v1/jobs/:id */
router.get('/:id', validate({ params: idParamSchema }), jobController.getById);

/** POST /api/v1/jobs/:id/cancel */
router.post('/:id/cancel', validate({ params: idParamSchema }), jobController.cancel);

/** DELETE /api/v1/jobs/:id — removes the job and its rows. */
router.delete('/:id', validate({ params: idParamSchema }), jobController.remove);

/** GET /api/v1/jobs/:id/results */
router.get(
  '/:id/results',
  validate({ params: idParamSchema, query: listResultsSchema }),
  jobController.listResults,
);

export default router;
