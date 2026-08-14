/** @fileoverview Кроссплатформенный безопасный запуск внешних CLI без shell. */

import { execa } from "execa";

const COMMAND_ENV = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});
export const DEFAULT_TIMEOUT = 120_000;

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
 * Асинхронно запускает executable из PATH с отдельным массивом аргументов без
 * глобального `shell: true`. При ошибке сохраняет вывод исходного CLI, но
 * скрывает переданные URL с credential.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {Record<string, string>} [options.environment] Дополнительное окружение процесса.
 * @param {(message: string) => void} [options.onStderr] Обработчик успешного stderr.
 * @param {string[]} [options.sensitiveValues]
 * @param {number} [options.timeout] Максимальное время выполнения в миллисекундах.
 * @returns {Promise<string>} stdout без пробелов по краям.
 */
export async function runCommand(
  command,
  args,
  {
    cwd,
    environment = {},
    onStderr = () => {},
    sensitiveValues = [],
    timeout = DEFAULT_TIMEOUT,
  } = {},
) {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Timeout внешней команды должен быть положительным числом");
  }
  const result = await execa(command, args, {
    cwd,
    env: { ...environment, ...COMMAND_ENV },
    reject: false,
    timeout,
  });

  if (result.failed) {
    const invocation = redact(`${command} ${args.join(" ")}`, sensitiveValues);
    const details = redact(
      [result.stderr, result.stdout].filter(Boolean).join("\n").trim(),
      sensitiveValues,
    );
    const reason = result.timedOut
      ? `превысила timeout ${timeout} мс`
      : result.signal
        ? `завершена сигналом ${result.signal}`
        : result.exitCode === undefined
          ? `не запущена: ${result.originalMessage ?? result.shortMessage}`
          : "завершилась с ошибкой";
    throw new Error(
      `${invocation} ${redact(reason, sensitiveValues)}${details ? `:\n${details}` : ""}`,
    );
  }

  const warning = redact(result.stderr.trim(), sensitiveValues);
  if (warning) onStderr(warning);

  return result.stdout;
}
