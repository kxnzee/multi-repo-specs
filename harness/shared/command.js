/** @fileoverview Кроссплатформенный безопасный запуск внешних CLI без shell. */

import process from "node:process";
import crossSpawn from "cross-spawn";

const COMMAND_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});

/**
 * Скрывает переданные секретные значения в диагностическом тексте команды.
 *
 * @param {string} value Исходная строка команды или её вывода.
 * @param {string[]} sensitiveValues Значения, которые нельзя показывать пользователю.
 * @returns {string} Строка с заменёнными чувствительными фрагментами.
 */
function redact(value, sensitiveValues) {
  let result = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive) result = result.split(sensitive).join("<repository-url>");
  }
  return result;
}

/**
 * Запускает executable из PATH с отдельным массивом аргументов. `cross-spawn`
 * обеспечивает одинаковое разрешение команд, включая npm `.cmd`-shim в Windows,
 * без глобального `shell: true`. При ошибке сохраняет вывод исходного CLI, но
 * скрывает переданные URL с credential.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {string[]} [options.sensitiveValues]
 * @returns {string} stdout без пробелов по краям.
 */
export function runCommand(command, args, { cwd, sensitiveValues = [] } = {}) {
  const result = crossSpawn.sync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...COMMAND_ENV },
  });

  if (result.error) {
    throw new Error(`Не удалось запустить ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const invocation = redact(`${command} ${args.join(" ")}`, sensitiveValues);
    const details = redact(
      [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
      sensitiveValues,
    );
    throw new Error(
      `${invocation} завершилась с ошибкой${details ? `:\n${details}` : ""}`,
    );
  }

  return result.stdout.trim();
}
