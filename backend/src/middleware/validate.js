import { ApiError } from '../utils/ApiError.js';

/**
 * Zod-backed request validation.
 *
 * Controllers never touch raw `req.body` / `req.query` — they read the parsed,
 * typed, defaulted values this middleware writes back. Invalid input is
 * rejected at the edge with a 422 and per-field details.
 *
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        return next(
          ApiError.validation(`Invalid request ${source}`, {
            source,
            issues: result.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code,
            })),
          }),
        );
      }

      // `req.query` is a getter-only accessor in Express 5; assign defensively.
      if (source === 'query') req.validatedQuery = result.data;
      else req[source] = result.data;
    }

    return next();
  };
}

export default validate;
