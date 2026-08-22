/** @fileoverview Чистая функция идентичности Snapshot v1 без доступа к state. */

import { createHash } from "node:crypto";

import { CONTRACT_VERSIONS, IDENTIFIER_PREFIXES } from "../config/constants.js";

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
 * Вычисляет идентичность Snapshot по фиксированной проекции v1.
 *
 * @param {string} cycleId Cycle ID.
 * @param {Array<{repository_id: string, implementation_revision: string}>} implementations Пары commit.
 * @returns {string} `snap-v1-<sha256>`.
 */
export function computeSnapshotId(cycleId, implementations) {
  const projection = {
    hash_version: CONTRACT_VERSIONS.snapshotHash,
    contract_version: CONTRACT_VERSIONS.snapshot,
    cycle_id: cycleId,
    implementations: canonicalImplementations(implementations),
  };
  const digest = createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
  return `${IDENTIFIER_PREFIXES.snapshot}${digest}`;
}
