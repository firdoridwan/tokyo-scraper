/**
 * Scraper source registry.
 *
 * The single place the application learns which websites exist. Services and
 * controllers depend on this registry, never on a specific site module — which
 * is what makes "support another directory" a one-line change here plus a new
 * folder under `scrapers/`.
 */
import { ApiError } from '../utils/ApiError.js';
import { hipagesModule } from './hipages/index.js';

/**
 * Registered site modules, keyed by their descriptor.
 *
 * A module is imported through its `index.js` only — the registry never reaches
 * into a site folder's internals, which is what lets a module reorganise freely.
 *
 * @type {import('./hipages/index.js').ScraperModule[]}
 */
const MODULES = [
  hipagesModule,
  // Register future sites here:
  // yellowPagesModule,
  // trueLocalModule,
];

/** @type {import('./types.js').SourceDescriptor[]} */
const SOURCES = MODULES.map((module) => module.descriptor);

/** @type {Map<string, import('./types.js').SourceDescriptor>} */
const sourcesById = new Map(SOURCES.map((source) => [source.id, source]));

/** All registered sources. */
export function listSources() {
  return [...sourcesById.values()];
}

/** @param {string} id */
export function findSource(id) {
  return sourcesById.get(id) ?? null;
}

/**
 * Same as `findSource` but throws a 404 instead of returning null — used by
 * services that cannot proceed without a valid source.
 * @param {string} id
 */
export function requireSource(id) {
  const source = findSource(id);
  if (!source) {
    throw ApiError.notFound(`Unknown source: "${id}"`, {
      availableSources: [...sourcesById.keys()],
    });
  }
  return source;
}

/** @param {string} id */
export function isSourceImplemented(id) {
  return Boolean(findSource(id)?.implemented);
}

/** @type {Map<string, import('./hipages/index.js').ScraperModule>} */
const modulesById = new Map(MODULES.map((module) => [module.descriptor.id, module]));

/**
 * Resolves the executable module (crawler + parser + extractor) for a source.
 *
 * Gated on the descriptor's `implemented` flag, so a module whose stubs are
 * still throwing cannot be handed to the runner by accident. Site modules import
 * no browser driver at load time, so holding them in memory costs nothing —
 * Playwright still enters the process only when the runner launches it.
 *
 * @param {string} id
 * @returns {import('./hipages/index.js').ScraperModule}
 */
export function loadModuleFor(id) {
  const source = requireSource(id);
  const module = modulesById.get(id);

  if (!module || !source.implemented) {
    throw ApiError.notImplemented(`The "${source.name}" scraper module is not implemented yet.`, {
      sourceId: source.id,
    });
  }

  return module;
}

export default { listSources, findSource, requireSource, isSourceImplemented, loadModuleFor };
