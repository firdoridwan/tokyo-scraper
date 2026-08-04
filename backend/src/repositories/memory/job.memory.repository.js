import { PAGINATION } from '../../config/constants.js';

/**
 * In-memory job store.
 *
 * Skeleton driver: it exists so the whole application can run, be demoed, and
 * be developed against before persistence is built. Data is lost on restart —
 * that is expected and acceptable at this stage.
 *
 * @implements {import('../types.js').JobRepository}
 */
export class MemoryJobRepository {
  /** @type {Map<string, import('../types.js').Job>} */
  #jobs = new Map();

  create(job) {
    this.#jobs.set(job.id, { ...job });
    return this.findById(job.id);
  }

  findById(id) {
    const job = this.#jobs.get(id);
    return job ? { ...job } : null;
  }

  findMany({
    page = PAGINATION.DEFAULT_PAGE,
    pageSize = PAGINATION.DEFAULT_PAGE_SIZE,
    status,
    sourceId,
  } = {}) {
    let items = [...this.#jobs.values()];

    if (status) items = items.filter((job) => job.status === status);
    if (sourceId) items = items.filter((job) => job.sourceId === sourceId);

    // Newest first — the dashboard and job list both want recency order.
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = items.length;
    const offset = (page - 1) * pageSize;

    return {
      items: items.slice(offset, offset + pageSize).map((job) => ({ ...job })),
      total,
    };
  }

  update(id, patch) {
    const existing = this.#jobs.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.#jobs.set(id, updated);
    return { ...updated };
  }

  remove(id) {
    return this.#jobs.delete(id);
  }

  stats() {
    const byStatus = {};
    for (const job of this.#jobs.values()) {
      byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    }
    return { total: this.#jobs.size, byStatus };
  }
}

export default MemoryJobRepository;
