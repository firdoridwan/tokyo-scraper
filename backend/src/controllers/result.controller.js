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

  /**
   * Sends a completed job's CSV as a file download.
   *
   * The one endpoint that answers with a file rather than the JSON envelope —
   * `res.download()` sets `Content-Disposition: attachment`, which is what makes
   * the browser save it instead of rendering it.
   */
  export: asyncHandler(async (req, res) => {
    const { filePath, fileName } = resultService.export(req.validatedQuery);
    return res.download(filePath, fileName);
  }),
};

export default resultController;
