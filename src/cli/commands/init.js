/** @fileoverview Пользовательский сценарий команды `openspec-orch init`. */

import path from "node:path";

import { initProject } from "../../internal/init/index.js";
import { reportProgress } from "../progress.js";

/**
 * Печатает именованный список созданных или дополненных файлов.
 *
 * @param {string} title Заголовок списка.
 * @param {string[]} paths Относительные пути файлов.
 * @returns {void}
 */
function printPaths(title, paths) {
  console.log(`${title} (${paths.length})`);
  for (const filePath of paths) console.log(`  ${filePath}`);
}

/**
 * Формирует следующую команду с учётом расположения Store.
 *
 * @param {string} storeRoot Канонический путь Store.
 * @param {string} storeId Store ID.
 * @returns {string} Готовая пользовательская подсказка.
 */
export function buildConnectHint(storeRoot, storeId) {
  const workspace = path.dirname(storeRoot);
  const standardLayout = (
    path.basename(storeRoot) === storeId &&
    path.basename(workspace) !== "openspec" &&
    path.dirname(workspace) !== workspace
  );
  const command = standardLayout
    ? "openspec-orch connect"
    : `openspec-orch connect --workspace ${JSON.stringify(workspace)}`;
  return `Далее: выполните ${command}`;
}

/**
 * Выполняет пользовательский сценарий `openspec-orch init`.
 *
 * @param {{target: string, storeId: string, agentId: string, templateRoot?: string, repositories: Array<{id: string, role: "code", url: string, defaultBranch: string}>, noStrict: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runInit(options) {
  reportProgress("Инициализация Store...");
  const result = await initProject({
    target: options.target,
    storeId: options.storeId,
    agentId: options.agentId,
    templateRoot: options.templateRoot,
    repositories: options.repositories,
    noStrict: options.noStrict,
  });
  if (result.alreadyInitialized) {
    console.log(`Store ${result.storeId} уже инициализирован; файлы не изменены.`);
    console.log(`Execution mode: ${result.executionMode}`);
    console.log(buildConnectHint(result.target, result.storeId));
    return;
  }
  console.log(`Store ${result.storeId}: ${result.target}`);
  console.log(`Agent: ${options.agentId}`);
  console.log(`Execution mode: ${result.executionMode}`);
  printPaths("Создано", result.created);
  if (result.updated.length > 0) printPaths("Дополнено", result.updated);
  console.log(buildConnectHint(result.target, result.storeId));
}
