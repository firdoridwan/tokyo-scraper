import { resultService } from '../services/result.service.js';
import { buildPaginationMeta, sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const resultController = {
  list: asyncHandler(async (req, res) => {
    const query = req.validatedQuery;
    const { items, total } = resultService.list(query);
    return sendSuccess(res, items, {
      meta: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    });
  }),

  /** Returns 501 until the exporter milestone — handled by the error middleware. */
  export: asyncHandler(async (req, res) =>
    sendSuccess(res, resultService.export(req.validatedQuery)),
  ),
};

export default resultController;
