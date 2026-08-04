/**
 * Response envelope.
 *
 * Every endpoint answers with the same shape, so the frontend HTTP client can
 * unwrap responses in exactly one place:
 *
 *   success -> { success: true,  data, meta? }
 *   failure -> { success: false, error: { code, message, details? } }
 */

/**
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {{ status?: number, meta?: object }} [options]
 */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * @param {import('express').Response} res
 * @param {{ status?: number, code: string, message: string, details?: unknown }} error
 */
export function sendError(res, { status = 500, code, message, details }) {
  const body = { success: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return res.status(status).json(body);
}

/**
 * Builds the `meta` block for a paginated collection.
 *
 * @param {{ page: number, pageSize: number, total: number }} params
 */
export function buildPaginationMeta({ page, pageSize, total }) {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}
