import { ApiError } from '../utils/ApiError.js';

/**
 * Terminal 404 handler — reached only when no route matched. Converting the
 * miss into an ApiError keeps unknown-route responses in the same envelope as
 * every other failure.
 */
export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export default notFound;
