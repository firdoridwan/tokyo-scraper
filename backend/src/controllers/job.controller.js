import { jobService } from '../services/job.service.js';
import { resultService } from '../services/result.service.js';
import { buildPaginationMeta, sendSuccess } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Job endpoints. Controllers only translate HTTP <-> service calls; no business
 * logic lives here.
 */
export const jobController = {
  create: asyncHandler(async (req, res) => {
    const job = jobService.create(req.body);
    return sendSuccess(res, job, { status: 201 });
  }),

  list: asyncHandler(async (req, res) => {
    const query = req.validatedQuery;
    const { items, total } = jobService.list(query);
    return sendSuccess(res, items, {
      meta: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    });
  }),

  getById: asyncHandler(async (req, res) => sendSuccess(res, jobService.getById(req.params.id))),

  cancel: asyncHandler(async (req, res) => sendSuccess(res, jobService.cancel(req.params.id))),

  remove: asyncHandler(async (req, res) => sendSuccess(res, jobService.remove(req.params.id))),

  listResults: asyncHandler(async (req, res) => {
    const query = req.validatedQuery;
    const { items, total } = resultService.listByJob(req.params.id, query);
    return sendSuccess(res, items, {
      meta: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    });
  }),

  stats: asyncHandler(async (req, res) => sendSuccess(res, jobService.stats())),
};

export default jobController;
