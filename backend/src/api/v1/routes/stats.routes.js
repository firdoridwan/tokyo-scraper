import { Router } from 'express';
import { jobController } from '../../../controllers/job.controller.js';

const router = Router();

/** GET /api/v1/stats — aggregate counters powering the dashboard tiles. */
router.get('/', jobController.stats);

export default router;
