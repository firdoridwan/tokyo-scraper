/**
 * API v1 router.
 *
 * The one place resource routers are mounted. Adding a resource means adding a
 * route file and a single `use()` line here — `app.js` never changes.
 */
import { Router } from 'express';
import healthRoutes from './routes/health.routes.js';
import sourceRoutes from './routes/source.routes.js';
import jobRoutes from './routes/job.routes.js';
import resultRoutes from './routes/result.routes.js';
import statsRoutes from './routes/stats.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/sources', sourceRoutes);
router.use('/jobs', jobRoutes);
router.use('/results', resultRoutes);
router.use('/stats', statsRoutes);

/** GET /api/v1 — self-describing index, useful when probing the API by hand. */
router.get('/', (req, res) =>
  res.json({
    success: true,
    data: {
      version: 'v1',
      resources: {
        health: '/api/v1/health',
        sources: '/api/v1/sources',
        jobs: '/api/v1/jobs',
        results: '/api/v1/results',
        stats: '/api/v1/stats',
      },
    },
  }),
);

export default router;
