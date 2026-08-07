/** @fileoverview Общая структурная проверка машинных JSON-ответов OpenSpec. */

import path from "node:path";

/**
 * Разбирает машинный ответ OpenSpec и не позволяет потерять диагностику,
 * которую команды doctor возвращают с успешным exit code.
 *
 * @param {string} output
 * @param {string} command
 * @returns {Record<string, any>} Проверенный JSON-объект OpenSpec.
 */
export function parseOpenSpecJson(output, command) {
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(`${command} вернула невалидный JSON`);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`${command} вернула некорректный JSON-объект`);
  }
  assertNoOpenSpecErrors(value, command);
  return value;
}

/**
 * Рекурсивно проверяет только массивы OpenSpec `status`; остальные поля status
 * могут быть строковыми состояниями Change и диагностикой не являются.
 *
 * @param {unknown} value
 * @param {string} command Название команды для диагностического сообщения.
 * @returns {void}
 */
export function assertNoOpenSpecErrors(value, command) {
  const errors = [];

  /**
   * Собирает диагностические ошибки из вложенных массивов OpenSpec `status`.
   *
   * @param {unknown} current Текущий узел JSON-дерева.
   * @returns {void}
   */
  function visit(current) {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (key === "status" && Array.isArray(item)) {
        for (const diagnostic of item) {
          if (diagnostic?.severity === "error") errors.push(diagnostic);
        }
      } else {
        visit(item);
      }
    }
  }

  visit(value);
  if (errors.length === 0) return;
  const details = errors
    .map(({ code, message }) => `${code ? `${code}: ` : ""}${message ?? "неизвестная ошибка"}`)
    .join("; ");
  throw new Error(`${command} сообщила об ошибке: ${details}`);
}

/**
 * Проверяет, что OpenSpec разрешил ожидаемый Store, а не nearest/default root.
 *
 * @param {Record<string, any>} root Разрешённый OpenSpec root из JSON-ответа.
 * @param {{path: string, storeId: string, source: string}} expected Ожидаемая identity root.
 * @param {string} command Название команды для диагностического сообщения.
 * @returns {void}
 */
export function assertOpenSpecRoot(root, expected, command) {
  if (!root || typeof root !== "object") {
    throw new Error(`${command} не вернула OpenSpec root`);
  }
  if (path.resolve(root.path ?? "") !== path.resolve(expected.path)) {
    throw new Error(`${command} разрешила другой OpenSpec root: ${root.path ?? "не указан"}`);
  }
  if (root.source !== expected.source) {
    throw new Error(`${command} вернула source: ${root.source ?? "не указан"}, ожидался ${expected.source}`);
  }
  if (root.store_id !== expected.storeId) {
    throw new Error(
      `${command} вернула Store ID ${root.store_id ?? "не указан"}, ожидался ${expected.storeId}`,
    );
  }
}
