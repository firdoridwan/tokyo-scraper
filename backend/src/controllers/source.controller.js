import { sourceService } from '../services/source.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const sourceController = {
  list: asyncHandler(async (req, res) => {
    const sources = sourceService.list();
    return sendSuccess(res, sources, { meta: { total: sources.length } });
  }),

  getById: asyncHandler(async (req, res) =>
    sendSuccess(res, sourceService.getById(req.params.id)),
  ),
};

export default sourceController;
