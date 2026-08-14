/** @fileoverview Пользовательский сценарий детерминированной команды `openspec-orch change`. */

import process from "node:process";
import { createInterface } from "node:readline/promises";

import { prepareChange } from "../change/index.js";
import { HELP, parseChangeArgs } from "./args.js";
import { reportProgress } from "./progress.js";

/**
 * Запрашивает подтверждение повторной работы по архивному ticket.
 *
 * @param {import("node:readline/promises").Interface} prompt Терминальный интерфейс.
 * @returns {Promise<boolean>} Решение Change Owner.
 */
async function confirmArchived(prompt) {
  while (true) {
    const answer = (await prompt.question("Продолжить создание Change? [y/N] ")).trim().toLowerCase();
    if (["y", "yes", "д", "да"].includes(answer)) return true;
    if (["", "n", "no", "н", "нет"].includes(answer)) return false;
    console.error("Введите yes/да или no/нет.");
  }
}

/**
 * Выполняет `openspec-orch change` и печатает единственный JSON-результат в stdout.
 *
 * @param {string[]} args Аргументы без имени команды.
 * @returns {Promise<void>}
 */
export async function runChange(args) {
  const options = parseChangeArgs(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  const prompt = process.stdin.isTTY === true
    ? createInterface({ input: process.stdin, output: process.stderr })
    : null;
  try {
    reportProgress("Подготовка Change...");
    const result = await prepareChange({
      ticket: options.ticket,
      name: options.name,
      storeId: options.storeId,
      confirmArchivedChange: prompt
        ? async (changes) => {
            console.error(`Найдены архивные Changes с ticket ${options.ticket}:`);
            for (const change of changes) console.error(`  ${change}`);
            return confirmArchived(prompt);
          }
        : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    prompt?.close();
  }
}
