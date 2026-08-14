/** @fileoverview Пользовательский сценарий команды `openspec-orch init`. */

import path from "node:path";

import { initProject } from "../init/index.js";
import { HELP, parseInitArgs } from "./args.js";
import { reportProgress } from "./progress.js";

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
 * @param {string[]} args Аргументы команды без имени `init`.
 * @returns {Promise<void>}
 */
export async function runInit(args) {
  const options = parseInitArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  reportProgress("Инициализация Store...");
  const result = await initProject({
    target: options.target,
    storeId: options.storeId,
    agentId: options.agentId,
    templateRoot: options.templateRoot,
    repositories: options.repositories,
  });
  if (result.alreadyInitialized) {
    console.log(`Store ${result.storeId} уже инициализирован; файлы не изменены.`);
    console.log(buildConnectHint(result.target, result.storeId));
    return;
  }
  console.log(`Store ${result.storeId}: ${result.target}`);
  console.log(`Agent: ${options.agentId}`);
  printPaths("Создано", result.created);
  if (result.updated.length > 0) printPaths("Дополнено", result.updated);
  console.log(buildConnectHint(result.target, result.storeId));
}
