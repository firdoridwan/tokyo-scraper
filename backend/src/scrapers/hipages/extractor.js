/**
 * hipages — extractor stubs.
 *
 * ⚠️  ARCHITECTURE ONLY. Every function throws. No extraction happens here yet.
 *
 * Responsibility (and its limits)
 * -------------------------------
 * The extractor is the module's OUTPUT CONTRACT. It takes the parser's loose,
 * source-shaped objects and produces clean records matching exactly the columns
 * declared in `descriptor.supportedOutputs`. It never reads markup and never
 * touches the network.
 *
 * This is the boundary the rest of the application depends on. `parser.js` may
 * change shape freely whenever hipages redesigns; as long as the extractor still
 * emits the declared columns, the repositories, API, and UI are unaffected.
 *
 * Normalisation belongs here
 * --------------------------
 * Phone formatting, ABN whitespace, rating coercion to number, absolute URL
 * resolution, empty-string → null. Doing this in the parser would scatter the
 * rules across every selector; doing it here keeps one auditable place where a
 * record earns its shape.
 *
 * On errors: `ApiError.notImplemented` is the project's not-implemented signal
 * (code `NOT_IMPLEMENTED`, surfaces as HTTP 501 via the existing middleware).
 */
import { ApiError } from '../../utils/ApiError.js';

/** @param {string} fn @param {string} [detail] */
const notImplemented = (fn, detail) =>
  ApiError.notImplemented(`hipages.extractor.${fn}() is not implemented yet.`, {
    sourceId: 'hipages',
    module: 'extractor',
    fn,
    ...(detail ? { detail } : {}),
  });

/**
 * Builds a business record from a listing stub alone.
 *
 * Used by `includeDetails: 'listing'` jobs. Fields only available on the profile
 * page must be present as `null` rather than absent — a consistent column set
 * is what lets the results table and future CSV export stay stable.
 *
 * @param {object} _stub Output of `parser.parseListingPage()`
 * @returns {object} Record keyed by `descriptor.supportedOutputs`
 * @throws {ApiError} Always — not implemented.
 */
export function extractFromListing(_stub) {
  throw notImplemented(
    'extractFromListing',
    'Must emit every supportedOutputs column, using null for profile-only fields.',
  );
}

/**
 * Merges a listing stub with its parsed profile detail into one record.
 *
 * Used by `includeDetails: 'full'` jobs. Conflict rule to settle during
 * implementation: profile-page values are the more authoritative source and
 * should win over card values, except where the profile field is empty.
 *
 * @param {object} _stub   Output of `parser.parseListingPage()`
 * @param {object} _detail Output of `parser.parseProfilePage()`
 * @returns {object} Record keyed by `descriptor.supportedOutputs`
 * @throws {ApiError} Always — not implemented.
 */
export function extractFromProfile(_stub, _detail) {
  throw notImplemented(
    'extractFromProfile',
    'Must merge stub + detail under an explicit precedence rule.',
  );
}

/**
 * Applies field-level normalisation to a single record.
 *
 * The one place formatting rules live: trim, collapse whitespace, coerce
 * numerics, resolve relative URLs, convert empty strings to null.
 *
 * @param {object} _record
 * @returns {object} Normalised record
 * @throws {ApiError} Always — not implemented.
 */
export function normalizeRecord(_record) {
  throw notImplemented(
    'normalizeRecord',
    'Must coerce rating/reviewCount to numbers and empty strings to null.',
  );
}

/**
 * Validates a record against the descriptor's declared output columns.
 *
 * Runs before persistence. Guarantees the module cannot quietly emit a column
 * it never declared, or omit one it promised — the check that keeps
 * `descriptor.supportedOutputs` honest rather than aspirational.
 *
 * @param {object} _record
 * @returns {{ valid: boolean, missing: string[], unexpected: string[] }}
 * @throws {ApiError} Always — not implemented.
 */
export function validateRecord(_record) {
  throw notImplemented(
    'validateRecord',
    'Must diff record keys against descriptor.supportedOutputs.',
  );
}

export const extractor = {
  extractFromListing,
  extractFromProfile,
  normalizeRecord,
  validateRecord,
};

export default extractor;
