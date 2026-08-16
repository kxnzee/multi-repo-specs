/** @fileoverview Оркестрация `openspec-orch status`: только чтение текущего Cycle. */

import { runCommand } from "../shared/command.js";
import { inspectImplementationRevision } from "../repository/revision.js";
import { computeSnapshotId } from "../snapshot/index.js";
import { readState } from "../state/index.js";
import { readCurrentCycle } from "./current.js";

/**
 * Читает текущий Cycle из рабочей копии Store и определяет следующее действие.
 * Текущим считается Cycle Record, найденный по нормативному пути в рабочей копии Store.
 *
 * @param {object} options Параметры.
 * @param {string} options.storeRoot Канонический путь рабочей копии Store.
 * @param {string} options.changeId change-id, переданный пользователем.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<import("./types.js").StatusResult>} Проверенное состояние Cycle.
 */
export async function readChangeStatus({ storeRoot, changeId, commandRunner = runCommand }) {
  const context = await readCurrentCycle({ storeRoot, changeId, commandRunner });
  const { cycle, committed } = context;
  const state = await readState(storeRoot);
  const repositories = await Promise.all(cycle.repositories.map(async (repositoryId) => {
    const receipt = state.result_receipts.find(
      (candidate) => candidate.cycle_id === cycle.cycleId && candidate.repository_id === repositoryId,
    );
    if (!receipt) {
      return {
        repositoryId,
        state: "missing",
        receipt: null,
        commitAvailable: null,
        head: null,
        headMatches: null,
      };
    }
    const implementation = await inspectImplementationRevision(
      context,
      repositoryId,
      receipt.implementation_revision,
      commandRunner,
    );
    return {
      repositoryId,
      state: implementation.available ? receipt.status : "commit_unavailable",
      receipt,
      commitAvailable: implementation.available,
      head: implementation.head,
      headMatches: implementation.head === null
        ? null
        : implementation.head === receipt.implementation_revision,
    };
  }));

  const allCompleted = repositories.every(({ state: repositoryState }) => repositoryState === "completed");
  const implementationPairs = allCompleted
    ? repositories.map(({ receipt }) => ({
      repository_id: receipt.repository_id,
      implementation_revision: receipt.implementation_revision,
    }))
    : [];
  const expectedSnapshotId = allCompleted
    ? computeSnapshotId(cycle.cycleId, implementationPairs)
    : null;
  const storedSnapshot = state.snapshots.find(({ cycle_id: cycleId }) => cycleId === cycle.cycleId) ?? null;
  const snapshot = storedSnapshot
    ? { ...storedSnapshot, current: storedSnapshot.snapshot_id === expectedSnapshotId }
    : null;
  const storedVerification = state.verification_receipts.find(
    ({ cycle_id: cycleId }) => cycleId === cycle.cycleId,
  ) ?? null;
  const verification = storedVerification
    ? {
      ...storedVerification,
      current: Boolean(snapshot?.current && storedVerification.snapshot_id === snapshot.snapshot_id),
    }
    : null;

  let nextAction;
  if (!committed) nextAction = "закоммитьте Cycle Record обычным процессом Git";
  else if (!allCompleted) {
    const pending = repositories
      .filter(({ state: repositoryState }) => repositoryState !== "completed")
      .map(({ repositoryId }) => repositoryId);
    nextAction = `записать результаты для репозиториев: ${pending.join(", ")}`;
  } else if (!snapshot?.current) nextAction = "вызвать verify";
  else if (!verification?.current) nextAction = "записать verification";
  else nextAction = "готово";
  return {
    changeId,
    cycle,
    committed,
    path: context.path,
    repositories,
    snapshot,
    verification,
    nextAction,
  };
}
