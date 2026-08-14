/** @fileoverview Пользовательский сценарий детерминированной команды `openspec-orch change`. */

import { confirm } from "@inquirer/prompts";
import process from "node:process";

import { prepareChange } from "../../internal/change/index.js";
import { reportProgress } from "../progress.js";

/**
 * Выполняет `openspec-orch change` и печатает единственный JSON-результат в stdout.
 *
 * @param {{ticket: string, name: string, storeId?: string, noStrict: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runChange(options) {
  reportProgress("Подготовка Change...");
  const result = await prepareChange({
    ticket: options.ticket,
    name: options.name,
    storeId: options.storeId,
    noStrict: options.noStrict,
    confirmArchivedChange: process.stdin.isTTY === true
      ? async (changes) => {
          console.error(`Найдены архивные Changes с ticket ${options.ticket}:`);
          for (const change of changes) console.error(`  ${change}`);
          return confirm(
            { message: "Продолжить создание Change?", default: false },
            { output: process.stderr },
          );
        }
      : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}
