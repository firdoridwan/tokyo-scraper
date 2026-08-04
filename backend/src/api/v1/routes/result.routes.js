import { Router } from 'express';
import { resultController } from '../../../controllers/result.controller.js';
import { validate } from '../../../middleware/validate.js';
import { exportResultsSchema, listResultsSchema } from '../../../validators/result.schema.js';

const router = Router();

/** GET /api/v1/results — all extracted rows across jobs. */
router.get('/', validate({ query: listResultsSchema }), resultController.list);

/** GET /api/v1/results/export — reserved; returns 501 until the exporter exists. */
router.get('/export', validate({ query: exportResultsSchema }), resultController.export);

export default router;
