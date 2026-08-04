/**
 * API version dispatcher.
 *
 * Versions are mounted side by side. When a breaking change is needed, `v2/`
 * appears next to `v1/` and both serve traffic — no client is forced to move.
 */
import { Router } from 'express';
import v1Router from './v1/index.js';

const router = Router();

router.use('/v1', v1Router);

/** Unversioned aliases so a bare `/api` call still tells you where to go. */
router.get('/', (req, res) =>
  res.json({
    success: true,
    data: { name: 'Tokyo Scraper API', versions: ['v1'], current: '/api/v1' },
  }),
);

export default router;
