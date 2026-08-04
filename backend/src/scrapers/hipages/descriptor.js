/**
 * hipages — module descriptor.
 *
 * METADATA ONLY. This file declares what the hipages module *is* and what it
 * *claims to support*. It contains no logic, no selectors, no navigation, and
 * imports nothing — it can be read, serialized, and served over HTTP safely.
 *
 * Two vocabularies, one source of truth
 * ------------------------------------
 * The module speaks in `supportedInputs` / `supportedOutputs` / `displayName`.
 * The application-wide `SourceDescriptor` contract (consumed by the registry,
 * `source.service.js`, and the React form) speaks in `fields` / `outputFields`
 * / `name`.
 *
 * Rather than duplicate the definitions, the arrays are declared once below and
 * the contract keys are assigned the *same references*. Editing an input edits
 * both views. See `../types.js` for the contract.
 */

/**
 * Parameters this source accepts. The frontend renders its form from this list,
 * so shape changes here change the UI with no frontend commit.
 *
 * @type {import('../types.js').SourceField[]}
 */
const SUPPORTED_INPUTS = [
  {
    name: 'category',
    label: 'Trade Category',
    type: 'text',
    required: true,
    placeholder: 'e.g. plumbers, electricians, builders',
    helpText: 'The trade or service category as it appears in the site URL.',
  },
  {
    name: 'location',
    label: 'Location',
    type: 'text',
    required: true,
    placeholder: 'e.g. sydney-nsw, melbourne-vic',
    helpText: 'Suburb or city slug used by the directory.',
  },
  {
    name: 'maxPages',
    label: 'Max Pages',
    type: 'number',
    required: false,
    min: 1,
    max: 100,
    defaultValue: 5,
    helpText: 'Upper bound on result pages to visit. Keep this modest.',
  },
  {
    name: 'includeDetails',
    label: 'Detail Level',
    type: 'select',
    required: false,
    defaultValue: 'listing',
    options: [
      { value: 'listing', label: 'Listing page only (fast)' },
      { value: 'full', label: 'Open each profile (slow, more fields)' },
    ],
    helpText: 'Opening every profile page multiplies request volume.',
  },
];

/**
 * Columns this source is intended to produce per business record.
 *
 * This is a *declaration of intent*, not a guarantee — no extraction exists
 * yet. `extractor.js` is the module that will have to satisfy this list.
 *
 * @type {string[]}
 */
const SUPPORTED_OUTPUTS = [
  'businessName',
  'category',
  'suburb',
  'state',
  'phone',
  'website',
  'abn',
  'rating',
  'reviewCount',
  'profileUrl',
];

/** @type {import('../types.js').SourceDescriptor} */
export const descriptor = {
  // ── Identity ───────────────────────────────────────────────────────────────
  id: 'hipages',
  displayName: 'hipages',
  baseUrl: 'https://hipages.com.au',
  country: 'AU',
  description:
    'Australian trade services directory. Extracts public business listings by trade category and location.',

  // ── Capability flags ───────────────────────────────────────────────────────
  /** Registry status. `available` = registered and selectable in the UI. */
  status: 'available',

  /**
   * False until `crawler.js`, `parser.js`, and `extractor.js` are implemented
   * AND `selectors.js` has been filled in against the live DOM. The registry
   * refuses to load an adapter while this is false, so no half-built module can
   * be executed by accident.
   */
  implemented: false,

  /**
   * The directory paginates its result pages, so `crawler.collectListingUrls()`
   * will need to walk them. Declared here so the runner can plan without
   * loading the crawler.
   */
  supportsPagination: true,

  /**
   * Resuming an interrupted job (re-entering at a known page/cursor) is not a
   * capability this module claims. Setting this true later requires the crawler
   * to accept and emit a resume cursor.
   */
  supportsResume: false,

  // ── Capability surface ─────────────────────────────────────────────────────
  supportedInputs: SUPPORTED_INPUTS,
  supportedOutputs: SUPPORTED_OUTPUTS,

  /**
   * SourceDescriptor contract aliases — same references as above, not copies.
   * These are what `source.service.js` projects to the API and what the React
   * form reads. Do not let them drift; assign, never redefine.
   */
  name: 'hipages',
  fields: SUPPORTED_INPUTS,
  outputFields: SUPPORTED_OUTPUTS,
};

export default descriptor;
