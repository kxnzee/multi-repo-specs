/** @fileoverview Детерминированное вычисление и сохранение Snapshot Alpha v1. */

import { assertCycleCommitted, readCurrentCycle } from "../cycle/current.js";
import { runCommand } from "../shared/command.js";
import { readState, withStateLock, writeState } from "../state/index.js";
import { SNAPSHOT_SCHEMA } from "../state/schema.js";
import { computeSnapshotId } from "./identity.js";

export { computeSnapshotId } from "./identity.js";

const CONTRACT_VERSION = 1;

/**
 * Возвращает канонически отсортированные реализации текущего Cycle.
 *
 * @param {import("../cycle/types.js").CycleRecord} cycle Текущий Cycle.
 * @param {ReturnType<import("../state/index.js").createEmptyState>} state Локальный state.
 * @returns {Array<{repository_id: string, implementation_revision: string}>} Пары Snapshot.
 */
export function currentImplementations(cycle, state) {
  const implementations = [];
  for (const repositoryId of [...cycle.repositories].sort()) {
    const receipt = state.result_receipts.find(
      (candidate) => candidate.cycle_id === cycle.cycleId && candidate.repository_id === repositoryId,
    );
    if (!receipt || receipt.status !== "completed") {
      throw new Error(
        `CYCLE_MISMATCH: для repository-id '${repositoryId}' нужен текущий Result Receipt completed`,
      );
    }
    implementations.push({
      repository_id: repositoryId,
      implementation_revision: receipt.implementation_revision,
    });
  }
  return implementations;
}

/**
 * Проверяет полноту результатов, вычисляет и сохраняет текущий Snapshot.
 *
 * @param {object} options Параметры verify.
 * @param {string} options.storeRoot Корень Store.
 * @param {string} options.changeId Change ID.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<{status: "created" | "unchanged", snapshot: object}>} Snapshot.
 */
export async function verifyCycle({ storeRoot, changeId, commandRunner = runCommand }) {
  return withStateLock(storeRoot, async () => {
    const context = await readCurrentCycle({ storeRoot, changeId, commandRunner });
    assertCycleCommitted(context);
    const state = await readState(storeRoot);
    const implementations = currentImplementations(context.cycle, state);
    const snapshotId = computeSnapshotId(context.cycle.cycleId, implementations);
    const existing = state.snapshots.find(({ cycle_id: cycleId }) => cycleId === context.cycle.cycleId);
    if (existing?.snapshot_id === snapshotId) return { status: "unchanged", snapshot: existing };

    const snapshot = SNAPSHOT_SCHEMA.parse({
      contract_version: CONTRACT_VERSION,
      snapshot_id: snapshotId,
      cycle_id: context.cycle.cycleId,
      implementations: Object.fromEntries(
        implementations.map(({ repository_id, implementation_revision }) => [repository_id, implementation_revision]),
      ),
      created_at: new Date().toISOString(),
    });
    await writeState(storeRoot, {
      ...state,
      snapshots: [
        ...state.snapshots.filter(({ cycle_id: cycleId }) => cycleId !== context.cycle.cycleId),
        snapshot,
      ],
    });
    return { status: "created", snapshot };
  });
}
