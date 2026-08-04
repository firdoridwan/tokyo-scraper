import { randomUUID } from 'node:crypto';

/**
 * Identifier helpers.
 *
 * Prefixed UUIDs ("job_9f3c…") make IDs self-describing in logs and URLs and
 * prevent an ID of one kind from being accepted where another is expected.
 */

/** @param {string} prefix */
export const createId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export const createJobId = () => createId('job');
export const createResultId = () => createId('res');
export const createRequestId = () => createId('req');

export default createId;
