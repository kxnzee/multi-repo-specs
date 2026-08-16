/** @fileoverview Единое чтение текущего Cycle и его Git-состояния. */

import { runCommand } from "../shared/command.js";
import { createGitClient } from "../shared/git-client.js";
import { assertChangeId } from "../shared/schema.js";
import { readStoreConfiguration } from "../shared/store.js";
import {
  assertCycleRepositories,
  cycleRecordPath,
  cycleRecordRelativePath,
  readCycleRecord,
} from "./record.js";

/**
 * Читает текущий Cycle, текущий registry и признак commit Cycle Record.
 *
 * @param {object} options Параметры.
 * @param {string} options.storeRoot Корень Store.
 * @param {string} options.changeId Change ID.
 * @param {typeof runCommand} [options.commandRunner] Исполнитель Git.
 * @returns {Promise<object>} Текущий Cycle context.
 */
export async function readCurrentCycle({ storeRoot, changeId, commandRunner = runCommand }) {
  assertChangeId(changeId);
  const { metadata, config } = await readStoreConfiguration(storeRoot);
  const cycle = await readCycleRecord(storeRoot, changeId);
  if (!cycle) {
    throw new Error(`CYCLE_NOT_FOUND: нет Cycle Record для change-id '${changeId}' в рабочей копии Store`);
  }
  assertCycleRepositories(cycle, config);
  const changedPaths = await createGitClient(storeRoot, commandRunner)
    .statusPaths([cycleRecordRelativePath(changeId)]);
  return {
    storeRoot,
    metadata,
    config,
    cycle,
    committed: changedPaths.length === 0,
    path: cycleRecordPath(storeRoot, changeId),
  };
}

/**
 * Блокирует операции над локальным state до commit Cycle Record.
 *
 * @param {Awaited<ReturnType<typeof readCurrentCycle>>} context Cycle context.
 * @returns {void}
 */
export function assertCycleCommitted(context) {
  if (!context.committed) {
    throw new Error("CYCLE_NOT_COMMITTED: сначала закоммитьте Cycle Record обычным процессом Git");
  }
}
