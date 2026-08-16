/** @fileoverview Пользовательский сценарий команды `openspec-orch status`. */

import process from "node:process";

import { readChangeStatus } from "../../internal/cycle/status.js";
import { findSpecRoot } from "../../internal/shared/store.js";

/**
 * Выполняет `openspec-orch status`: только чтение текущего Cycle из рабочей копии Store.
 *
 * @param {{changeId: string}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runStatus(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const result = await readChangeStatus({ storeRoot, changeId: options.changeId });
  console.log(`change_id: ${result.changeId}`);
  console.log(`cycle_id: ${result.cycle.cycleId}`);
  console.log(`planning_revision: ${result.cycle.planningRevision}`);
  console.log(`repositories: ${result.cycle.repositories.join(", ")}`);
  console.log(`committed: ${result.committed ? "да" : "нет"}`);
  if (!result.committed) console.log("Предупреждение: Cycle Record ещё не закоммичен.");
  console.log(`следующее действие: ${result.nextAction}`);
}
