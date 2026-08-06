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
    name: 'categoryUrl',
    label: 'Category URL',
    type: 'text',
    required: true,
    placeholder: 'https://hipages.com.au/find/electricians/nsw/sydney',
    helpText: 'Paste a hipages category page URL. Its pagination is walked from here.',
  },
  {
    // Replaces the old `limit` / "Target Emails" field. Nothing bounds a run any
    // more — every company hipages lists is opened in both modes — so the one
    // choice left to the operator is which of them end up in the files.
    //
    // The option values are the literals `scrapingPipeline.SCRAPING_MODE` holds.
    // They are repeated rather than imported because this file imports nothing
    // by design (see the header); `toScrapingMode()` is what they are validated
    // against, and it defaults anything unrecognised to `all`.
    name: 'scrapingMode',
    label: 'Scraping Mode',
    type: 'select',
    required: false,
    defaultValue: 'all',
    options: [
      { value: 'all', label: 'All Companies' },
      { value: 'with-email', label: 'Only Companies With Email' },
    ],
    helpText:
      'Every company hipages lists is checked either way, and the run always ends at the ' +
      'end of the source. This only decides what is exported: every company, or only the ' +
      'ones with an email address.',
  },
];

/**
 * Columns this source produces per business record.
 *
 * These are the columns the scraping pipeline actually fills and the CSV
 * exporter actually writes — the UI lists them beside the form, so an
 * aspirational list here would promise fields the downloaded file does not
 * contain.
 *
 * @type {string[]}
 */
const SUPPORTED_OUTPUTS = [
  'companyName',
  'phoneNumber',
  'website',
  'email',
  'businessLocation',
  'rating',
  'totalReviews',
  'credentials',
  'services',
  'hipagesUrl',
  'status',
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
   * True: this source executes. `crawler.js` walks the category, `parser.js`
   * reads each profile, and `scrapingPipeline.service.js` sequences them with
   * the website visitor and the email extractor.
   *
   * The UI reads this flag to decide whether to warn that a source cannot run,
   * so leaving it false would make the page claim the run is a no-op.
   *
   * `extractor.js` and `selectors.js` remain stubs and are not on that path —
   * they belong to the listing-page route (`parseListingPage`), which nothing
   * calls yet.
   */
  implemented: true,

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
