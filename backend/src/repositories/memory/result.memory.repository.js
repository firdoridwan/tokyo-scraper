import { PAGINATION } from '../../config/constants.js';

/**
 * In-memory result store — the counterpart to `MemoryJobRepository`.
 *
 * @implements {import('../types.js').ResultRepository}
 */
export class MemoryResultRepository {
  /** @type {Map<string, import('../types.js').Result>} */
  #results = new Map();

  create(result) {
    this.#results.set(result.id, { ...result });
    return { ...result };
  }

  createMany(results) {
    for (const result of results) this.#results.set(result.id, { ...result });
    return results.length;
  }

  findMany({
    page = PAGINATION.DEFAULT_PAGE,
    pageSize = PAGINATION.DEFAULT_PAGE_SIZE,
    jobId,
    sourceId,
    search,
  } = {}) {
    let items = [...this.#results.values()];

    if (jobId) items = items.filter((result) => result.jobId === jobId);
    if (sourceId) items = items.filter((result) => result.sourceId === sourceId);
    if (search) {
      const needle = search.toLowerCase();
      items = items.filter((result) =>
        JSON.stringify(result.data ?? {}).toLowerCase().includes(needle) ||
        result.businessName?.toLowerCase().includes(needle),
      );
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = items.length;
    const offset = (page - 1) * pageSize;

    return {
      items: items.slice(offset, offset + pageSize).map((result) => ({ ...result })),
      total,
    };
  }

  countByJob(jobId) {
    let count = 0;
    for (const result of this.#results.values()) {
      if (result.jobId === jobId) count += 1;
    }
    return count;
  }

  removeByJob(jobId) {
    let removed = 0;
    for (const [id, result] of this.#results.entries()) {
      if (result.jobId === jobId) {
        this.#results.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  stats() {
    return { total: this.#results.size };
  }
}

export default MemoryResultRepository;
