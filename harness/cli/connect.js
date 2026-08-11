/** @fileoverview Пользовательский сценарий команды `sdd connect`. */

import { connectProject } from "../connect/index.js";
import { HELP, parseConnectArgs } from "./args.js";
import { reportProgress } from "./progress.js";

/**
 * Выполняет `sdd connect` и печатает состояние каждого Code Repository.
 *
 * @param {string[]} args Аргументы команды без имени `connect`.
 * @returns {Promise<void>}
 */
export async function runConnect(args) {
  const options = parseConnectArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  const result = await connectProject({
    workspace: options.workspace,
    onProgress: reportProgress,
  });
  console.log(`Store: ${result.storeId} (${result.storeRoot})`);
  console.log(`Workspace: ${result.workspace}`);
  if (options.workspace) console.log("Workspace сохранён локально для следующих команд SDD.");
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
