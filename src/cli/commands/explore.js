/** @fileoverview Интерактивный пользовательский сценарий `openspec-orch explore`. */

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { buildExploreInvocation, prepareExplore } from "../../internal/explore/index.js";
import { confirm } from "../prompt.js";
import { reportProgress } from "../progress.js";

/**
 * Минимальный интерфейс интерактивного терминала.
 *
 * @typedef {object} Prompt
 * @property {(question: string) => Promise<string>} question
 * @property {() => void} close
 */

/**
 * Запрашивает непустой текст.
 *
 * @param {Prompt} prompt Терминальный интерфейс.
 * @param {string} question Текст приглашения.
 * @returns {Promise<string>} Непустой ответ.
 */
async function askRequiredText(prompt, question) {
  while (true) {
    const answer = (await prompt.question(question)).trim();
    if (answer) return answer;
    console.log("Введите непустой ответ.");
  }
}

/**
 * Преобразует номера выбора в repository-id.
 *
 * @param {string} answer Ввод пользователя.
 * @param {Array<{id: string}>} repositories Доступные репозитории.
 * @returns {string[]} Выбранные repository-id.
 */
function parseRepositoryNumbers(answer, repositories) {
  if (!answer.trim()) return [];
  const tokens = answer.trim().split(/[\s,]+/);
  const indexes = [];
  const seen = new Set();
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) throw new Error(`Некорректный номер: ${token}`);
    const index = Number(token) - 1;
    if (index < 0 || index >= repositories.length) {
      throw new Error(`Репозитория с номером ${token} нет в checklist`);
    }
    if (seen.has(index)) throw new Error(`Репозиторий с номером ${token} выбран повторно`);
    seen.add(index);
    indexes.push(index);
  }
  return indexes.map((index) => repositories[index].id);
}

/**
 * Показывает и подтверждает область Explore.
 *
 * @param {Prompt} prompt Терминальный интерфейс.
 * @param {Array<{id: string, defaultBranch: string}>} repositories Доступные репозитории.
 * @returns {Promise<string[]>} Подтверждённые repository-id.
 */
async function selectRepositories(prompt, repositories) {
  console.log("Code Repositories для Explore:");
  if (repositories.length === 0) console.log("  Зарегистрированных Code Repositories нет.");
  for (const [index, repository] of repositories.entries()) {
    console.log(`  [ ] ${index + 1}. ${repository.id} (${repository.defaultBranch})`);
  }
  while (true) {
    const answer = await prompt.question(
      "Введите номера через запятую; Enter — Explore только по Spec Root: ",
    );
    let selected;
    try {
      selected = parseRepositoryNumbers(answer, repositories);
    } catch (error) {
      console.log(error.message);
      continue;
    }
    const description = selected.length === 0 ? "только Spec Root" : selected.join(", ");
    if (await confirm(prompt, `Подтвердить область Explore: ${description}?`)) return selected;
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
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    reportProgress("Проверка Store и Code Repositories...");
    const result = await prepareExplore({
      ticket: options.ticket,
      workspace: options.workspace,
      noStrict: options.noStrict,
      selectRepositories: (repositories) => selectRepositories(prompt, repositories),
      confirmArchivedChange: async (changes) => {
        console.log(`Найдены архивные Changes с ticket ${options.ticket}:`);
        for (const change of changes) console.log(`  ${change}`);
        return confirm(prompt, "Продолжить новый Explore для этого ticket?");
      },
      onProgress: reportProgress,
    });
    const intent = await askRequiredText(prompt, "Кратко опишите намерение запроса: ");
    printExploreResult({ ...result, intent });
  } finally {
    prompt.close();
  }
}
