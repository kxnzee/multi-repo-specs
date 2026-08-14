/** @fileoverview Пользовательский сценарий детерминированной команды `openspec-orch change`. */

import process from "node:process";
import { createInterface } from "node:readline/promises";

import { prepareChange } from "../../internal/change/index.js";
import { confirm } from "../prompt.js";
import { reportProgress } from "../progress.js";

/**
 * Выполняет `openspec-orch change` и печатает единственный JSON-результат в stdout.
 *
 * @param {{ticket: string, name: string, storeId?: string, noStrict: boolean}} options Нормализованные параметры команды.
 * @returns {Promise<void>}
 */
export async function runChange(options) {
  const prompt = process.stdin.isTTY === true
    ? createInterface({ input: process.stdin, output: process.stderr })
    : null;
  try {
    reportProgress("Подготовка Change...");
    const result = await prepareChange({
      ticket: options.ticket,
      name: options.name,
      storeId: options.storeId,
      noStrict: options.noStrict,
      confirmArchivedChange: prompt
        ? async (changes) => {
            console.error(`Найдены архивные Changes с ticket ${options.ticket}:`);
            for (const change of changes) console.error(`  ${change}`);
            return confirm(prompt, "Продолжить создание Change?", console.error);
          }
        : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    prompt?.close();
  }
}
