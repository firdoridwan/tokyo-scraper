import { Router } from 'express';
import { healthController } from '../../../controllers/health.controller.js';

const router = Router();

/** GET /api/v1/health — liveness + subsystem readiness. */
router.get('/', healthController.check);

export default router;
