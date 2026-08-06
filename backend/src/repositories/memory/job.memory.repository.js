import { PAGINATION, TERMINAL_JOB_STATUSES } from '../../config/constants.js';

/**
 * In-memory job store.
 *
 * Skeleton driver: it exists so the whole application can run, be demoed, and
 * be developed against before persistence is built. Data is lost on restart —
 * that is expected and acceptable at this stage.
 *
 * Terminal states are enforced HERE
 * --------------------------------
 * A job that has reached `completed`, `failed` or `cancelled` can never be
 * written to again. That rule lives in the store rather than in the services
 * because the store is the only thing every writer goes through, and the writers
 * are concurrent by design: a background run publishes progress on its own
 * schedule while an HTTP request can cancel or finish the same job at any
 * moment between two of those writes.
 *
 * Enforcing it anywhere else means enforcing it in every caller — and the one
 * caller that forgets is exactly the bug this guard exists to make impossible:
 * a cancelled job that a still-draining run later marks `completed`.
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

  /**
   * Applies a patch, unless the job has already finished.
   *
   * A write to a terminal job is dropped and the stored record is returned
   * unchanged — not null, which means "no such job" and would send a caller
   * looking for a record that is right there. Callers that need to know whether
   * their write landed compare the returned status to what they asked for;
   * callers that are only publishing progress correctly ignore the result.
   *
   * Dropping rather than throwing is deliberate. Losing a race is the normal
   * outcome for a background run whose job was cancelled mid-flight, not an
   * error anyone can act on, and an exception thrown from a progress callback
   * would have to be caught by every publisher to avoid killing the run.
   *
   * @param {string} id
   * @param {Partial<import('../types.js').Job>} patch
   * @returns {import('../types.js').Job|null}
   */
  update(id, patch) {
    const existing = this.#jobs.get(id);
    if (!existing) return null;
    if (TERMINAL_JOB_STATUSES.includes(existing.status)) return { ...existing };

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
