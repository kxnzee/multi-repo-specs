/** @fileoverview Единый пользовательский вывод прогресса команд SDD. */

import process from "node:process";

/**
 * Печатает этап операции отдельно от результата команды.
 *
 * @param {string} message Краткое описание текущего этапа.
 * @param {{write: (chunk: string) => unknown}} [output] Поток вывода; переопределяется в тестах.
 * @returns {void}
 */
export function reportProgress(message, output = process.stderr) {
  output.write(`${message}\n`);
}
