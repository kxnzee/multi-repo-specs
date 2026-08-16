/** @fileoverview Оркестрация `openspec-orch status`: только чтение текущего Cycle. */

import { runCommand } from "../shared/command.js";
import { createGitClient } from "../shared/git-client.js";
import { assertChangeId } from "../shared/schema.js";
import { readStoreConfiguration } from "../shared/store.js";
import { cycleRecordPath, cycleRecordRelativePath, readCycleRecord } from "./record.js";

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
  assertChangeId(changeId);
  await readStoreConfiguration(storeRoot);
  const cycle = await readCycleRecord(storeRoot, changeId);
  if (!cycle) {
    throw new Error(`CYCLE_NOT_FOUND: нет Cycle Record для change-id '${changeId}' в рабочей копии Store`);
  }
  const changedPaths = await createGitClient(storeRoot, commandRunner)
    .statusPaths([cycleRecordRelativePath(changeId)]);
  const committed = changedPaths.length === 0;
  const nextAction = committed
    ? `записать результаты для репозиториев: ${cycle.repositories.join(", ")}`
    : "закоммитьте Cycle Record обычным процессом Git";
  return {
    changeId,
    cycle,
    committed,
    path: cycleRecordPath(storeRoot, changeId),
    nextAction,
  };
}
