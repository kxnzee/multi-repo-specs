/** @fileoverview Единый пользовательский вывод прогресса команд OpenSpec Orchestrator. */

import process from "node:process";
import ora from "ora";

/** @typedef {"running" | "success" | "info" | "warning" | "failure"} ProgressStatus */

/** @type {ReturnType<typeof ora> | null} */
let activeSpinner = null;

const SYMBOLS = Object.freeze({
  running: "…",
  success: "✓",
  info: "•",
  warning: "!",
  failure: "✗",
});

/**
 * Завершает активный TTY spinner перед интерактивным prompt.
 *
 * @returns {void}
 */
export function stopProgress() {
  activeSpinner?.stop();
  activeSpinner = null;
}

/**
 * Обновляет интерактивный spinner или пишет append-only событие в обычный stderr.
 *
 * @param {string} message Краткое описание текущего этапа.
 * @param {ProgressStatus} [status] Состояние этапа.
 * @param {{write: (chunk: string) => unknown, isTTY?: boolean}} [output] Поток вывода; переопределяется в тестах.
 * @returns {void}
 */
export function reportProgress(message, status = "running", output = process.stderr) {
  if (output.isTTY !== true) {
    output.write(`${SYMBOLS[status]} ${message}\n`);
    return;
  }

  if (!activeSpinner) activeSpinner = ora({ stream: output });
  activeSpinner.text = message;
  if (status === "running") {
    activeSpinner.start();
    return;
  }
  if (status === "success") activeSpinner.succeed();
  else if (status === "info") activeSpinner.info();
  else if (status === "warning") activeSpinner.warn();
  else activeSpinner.fail();
  activeSpinner = null;
}

/**
 * Выполняет один пользовательский этап и гарантированно завершает его индикатор.
 *
 * @template T
 * @param {{start: string, success: string, failure: string}} messages Тексты состояний.
 * @param {() => Promise<T>} operation Асинхронная операция.
 * @param {{write: (chunk: string) => unknown, isTTY?: boolean}} [output] Поток вывода.
 * @returns {Promise<T>} Результат операции.
 */
export async function withProgress(messages, operation, output = process.stderr) {
  reportProgress(messages.start, "running", output);
  try {
    const result = await operation();
    reportProgress(messages.success, "success", output);
    return result;
  } catch (error) {
    reportProgress(messages.failure, "failure", output);
    throw error;
  }
}
