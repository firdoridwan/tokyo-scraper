import { Router } from 'express';
import { sourceController } from '../../../controllers/source.controller.js';
import { validate } from '../../../middleware/validate.js';
import { idParamSchema } from '../../../validators/common.schema.js';

const router = Router();

/** GET /api/v1/sources — every registered directory site. */
router.get('/', sourceController.list);

/** GET /api/v1/sources/:id — one descriptor, including its input fields. */
router.get('/:id', validate({ params: idParamSchema }), sourceController.getById);

export default router;
