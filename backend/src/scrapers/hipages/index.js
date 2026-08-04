/**
 * hipages — module entry point.
 *
 * The module's only public surface. The registry imports this file and nothing
 * else inside the folder, so every internal file can be renamed, split, or
 * rewritten without touching a line outside this directory.
 *
 * Composition only — no logic lives here.
 */
import { descriptor } from './descriptor.js';
import { selectors } from './selectors.js';
import { crawler } from './crawler.js';
import { parser } from './parser.js';
import { extractor } from './extractor.js';

/**
 * @typedef {object} ScraperModule
 * @property {import('../types.js').SourceDescriptor} descriptor
 * @property {typeof selectors} selectors
 * @property {typeof crawler} crawler
 * @property {typeof parser} parser
 * @property {typeof extractor} extractor
 */

/** @type {ScraperModule} */
export const hipagesModule = {
  descriptor,
  selectors,
  crawler,
  parser,
  extractor,
};

export { descriptor, selectors, crawler, parser, extractor };

export default hipagesModule;
