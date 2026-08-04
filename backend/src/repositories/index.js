/**
 * Repository factory — the persistence seam.
 *
 * Services depend on the *interface* described in `types.js`, never on a
 * concrete store. Today the in-memory driver is wired up; when the SQLite
 * modules land, they implement the same interface and only the switch below
 * changes (driven by `PERSISTENCE_DRIVER` in the environment).
 *
 * No SQLite code exists yet — by design.
 */
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { MemoryJobRepository } from './memory/job.memory.repository.js';
import { MemoryResultRepository } from './memory/result.memory.repository.js';

function createRepositories(driver) {
  switch (driver) {
    case 'memory':
      return {
        driver: 'memory',
        jobs: new MemoryJobRepository(),
        results: new MemoryResultRepository(),
      };

    case 'sqlite':
      // Step 1 of the persistence milestone: implement
      //   repositories/sqlite/{job,result}.sqlite.repository.js
      // against the same interface, then return them here.
      throw new Error(
        'PERSISTENCE_DRIVER="sqlite" is not implemented yet. Use "memory" until the SQLite repositories are built.',
      );

    default:
      throw new Error(`Unknown PERSISTENCE_DRIVER: "${driver}"`);
  }
}

export const repositories = createRepositories(config.persistence.driver);

logger.info('Persistence layer ready', { driver: repositories.driver });

export const jobRepository = repositories.jobs;
export const resultRepository = repositories.results;

export default repositories;
