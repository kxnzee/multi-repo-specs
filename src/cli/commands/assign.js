/** @fileoverview Пользовательский сценарий команды `openspec-orch assign`. */

import process from "node:process";
import { confirm as promptConfirm } from "@inquirer/prompts";

import { assignCycle } from "../../internal/cycle/assign.js";
import { findSpecRoot } from "../../internal/shared/store.js";
import { stopProgress } from "../progress.js";

/**
 * Печатает preview будущей записи и запрашивает интерактивное подтверждение.
 * Core никогда не создаёт Git commit — только записывает Cycle Record.
 *
 * @param {import("../../internal/cycle/types.js").AssignPreview} preview Проверенный preview.
 * @returns {Promise<boolean>} Подтвердил ли пользователь запись.
 */
async function confirmAssign(preview) {
  console.log(`change_id: ${preview.changeId}`);
  console.log(`planning_revision: ${preview.planningRevision}`);
  console.log(`repositories: ${preview.repositories.join(", ")}`);
  console.log(`Cycle Record: ${preview.path}`);
  if (preview.kind === "replace") {
    console.log(`Существующий cycle_id ${preview.existing.cycleId} перестанет быть текущим.`);
    console.log("Будет создан новый cycle_id.");
  }
  console.log("Core не создаст Git commit; закоммитьте файл самостоятельно.");
  stopProgress();
  return promptConfirm({ message: "Записать Cycle Record?", default: false });
}

/**
 * Выполняет `openspec-orch assign`.
 *
 * @param {{changeId: string, repositoryIds: string[]}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runAssign(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const result = await assignCycle({
    storeRoot,
    changeId: options.changeId,
    repositoryIds: options.repositoryIds,
    confirm: confirmAssign,
  });
  if (result.status === "cancelled") {
    console.log("Отменено пользователем; Cycle Record не записан.");
    return;
  }
  if (result.status === "unchanged") {
    console.log(`Cycle не изменился: ${result.cycle.cycleId}`);
    console.log(`Cycle Record: ${result.path}`);
    return;
  }
  console.log(`Cycle Record ${result.status === "created" ? "создан" : "заменён"}: ${result.cycle.cycleId}`);
  console.log(`Cycle Record: ${result.path}`);
  console.log("Закоммитьте файл обычным процессом Git; до коммита record и verify недоступны.");
}
