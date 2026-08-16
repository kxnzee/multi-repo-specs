/** @fileoverview Пользовательский сценарий команды `openspec-orch connect`. */

import { connectProject } from "../../internal/connect/index.js";
import { reportProgress, withProgress } from "../progress.js";

/**
 * Выполняет `openspec-orch connect` и печатает состояние каждого Code Repository.
 *
 * @param {{workspace?: string, noStrict: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runConnect(options) {
  const result = await withProgress(
    {
      start: "Подключение Store и Code Repositories",
      success: "Store и Code Repositories подключены",
      failure: "Подключение не завершено",
    },
    () => connectProject({
      workspace: options.workspace,
      noStrict: options.noStrict,
      onProgress: reportProgress,
    }),
  );
  console.log(`Store: ${result.storeId} (${result.storeRoot})`);
  console.log(`Workspace: ${result.workspace}`);
  console.log(`Execution mode: ${result.executionMode}`);
  if (options.workspace && result.executionMode === "strict") {
    console.log("Workspace сохранён локально для следующих команд OpenSpec Orchestrator.");
  } else if (options.workspace) {
    console.log("Workspace использован только для текущего relaxed-вызова и не сохранён локально.");
  }
  console.log("Локальная регистрация Store проверена OpenSpec.");
  for (const repository of result.repositories) {
    console.log(`${repository.id}: ${repository.status}${repository.cloned ? ", cloned" : ", existing"}`);
    console.log(`  ${repository.path}`);
    if (repository.pointerCreated) console.log("  создан openspec/config.yaml; требуется setup PR");
    else if (repository.pointerPending) console.log("  openspec/config.yaml ещё не принят; требуется setup PR");
  }
  console.log(`connect_status: ${result.status}`);
  if (result.status === "ready") console.log("Локальное подключение готово.");
}
