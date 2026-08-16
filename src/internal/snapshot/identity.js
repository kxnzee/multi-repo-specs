/** @fileoverview Чистая Alpha v1-функция идентичности Snapshot без доступа к state. */

import { createHash } from "node:crypto";

const SNAPSHOT_HASH_VERSION = 1;
const CONTRACT_VERSION = 1;

/**
 * Возвращает фиксированную каноническую проекцию реализаций Snapshot.
 *
 * @param {Array<{repository_id: string, implementation_revision: string}>} implementations Пары commit.
 * @returns {Array<{repository_id: string, implementation_revision: string}>} Отсортированная проекция.
 */
export function canonicalImplementations(implementations) {
  return [...implementations]
    .sort((left, right) => left.repository_id.localeCompare(right.repository_id))
    .map(({ repository_id, implementation_revision }) => ({
      repository_id,
      implementation_revision,
    }));
}

/**
 * Вычисляет идентичность Snapshot по фиксированной Alpha v1 проекции.
 *
 * @param {string} cycleId Cycle ID.
 * @param {Array<{repository_id: string, implementation_revision: string}>} implementations Пары commit.
 * @returns {string} `snap-v1-<sha256>`.
 */
export function computeSnapshotId(cycleId, implementations) {
  const projection = {
    hash_version: SNAPSHOT_HASH_VERSION,
    contract_version: CONTRACT_VERSION,
    cycle_id: cycleId,
    implementations: canonicalImplementations(implementations),
  };
  const digest = createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
  return `snap-v1-${digest}`;
}
