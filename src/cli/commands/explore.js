/** @fileoverview Интерактивный пользовательский сценарий `openspec-orch explore`. */

import { checkbox, confirm, input } from "@inquirer/prompts";
import process from "node:process";
import { buildExploreInvocation, prepareExplore } from "../../internal/explore/index.js";
import { reportProgress, stopProgress, withProgress } from "../progress.js";

/**
 * Показывает и подтверждает область Explore.
 *
 * @param {Array<{id: string, defaultBranch: string}>} repositories Доступные репозитории.
 * @returns {Promise<string[]>} Подтверждённые repository-id.
 */
async function selectRepositories(repositories) {
  stopProgress();
  while (true) {
    const selected = repositories.length === 0
      ? []
      : await checkbox({
          message: "Выберите Code Repositories для Explore",
          choices: repositories.map((repository) => ({
            name: `${repository.id} (${repository.defaultBranch})`,
            value: repository.id,
          })),
        });
    const description = selected.length === 0 ? "только Spec Root" : selected.join(", ");
    if (await confirm({
      message: `Подтвердить область Explore: ${description}?`,
      default: false,
    })) return selected;
  }
}

/**
 * Печатает проверенную область Explore и готовую slash-команду.
 *
 * @param {object} result Проверенный результат с пользовательским намерением.
 * @returns {void}
 */
function printExploreResult(result) {
  console.log(`Explore подготовлен: ${result.ticket}`);
  console.log(`Намерение: ${result.intent}`);
  console.log(`Spec Root: ${result.projectRoot}`);
  console.log(`Workspace: ${result.workspace}`);
  console.log(`Execution mode: ${result.executionMode}`);
  console.log(`Store revision: ${result.store.revision}`);
  if (result.projectSpecsOnly) {
    console.log(`Code Repositories: нет, Explore только по ${result.storeRepositoryId}`);
  } else {
    console.log(`Code Repositories (${result.repositories.length}):`);
    for (const repository of result.repositories) {
      console.log(`  ${repository.id}`);
      console.log(`    branch: ${repository.branch}`);
      console.log(`    revision: ${repository.revision}`);
      console.log(`    path: ${repository.path}`);
    }
  }
  console.log("Команда для выбранного агента — скопируйте строку целиком:");
  console.log(buildExploreInvocation(result));
}

/**
 * Выполняет интерактивный сценарий `openspec-orch explore`.
 *
 * @param {{ticket: string, workspace?: string, noStrict: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runExplore(options) {
  if (process.stdin.isTTY !== true) {
    throw new Error("openspec-orch explore требует интерактивный TTY для выбора и ввода намерения");
  }
  const result = await withProgress(
    {
      start: "Проверка Store и Code Repositories",
      success: "Область Explore проверена",
      failure: "Explore не подготовлен",
    },
    () => prepareExplore({
      ticket: options.ticket,
      workspace: options.workspace,
      noStrict: options.noStrict,
      selectRepositories,
      confirmArchivedChange: async (changes) => {
        stopProgress();
        console.log(`Найдены архивные Changes с ticket ${options.ticket}:`);
        for (const change of changes) console.log(`  ${change}`);
        return confirm({ message: "Продолжить новый Explore для этого ticket?", default: false });
      },
      onProgress: reportProgress,
    }),
  );
  const intent = (await input({
    message: "Кратко опишите намерение запроса",
    validate: (value) => value.trim().length > 0 || "Введите непустой ответ.",
  })).trim();
  printExploreResult({ ...result, intent });
}
