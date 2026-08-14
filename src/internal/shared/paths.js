/** @fileoverview Общие проверки переносимых и вложенных путей. */

import path from "node:path";

/**
 * Проверяет, находится ли абсолютный путь внутри заданного root.
 *
 * @param {string} root Канонический корневой путь.
 * @param {string} candidate Проверяемый абсолютный путь.
 * @param {{allowRoot?: boolean}} [options] Разрешить совпадение с root.
 * @returns {boolean} Результат проверки.
 */
export function isContainedPath(root, candidate, { allowRoot = false } = {}) {
  const relative = path.relative(root, candidate);
  if (relative === "") return allowRoot;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Проверяет безопасный переносимый относительный POSIX-путь.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {{allowDot?: boolean}} [options] Разрешить значение `.`.
 * @returns {boolean} Результат проверки.
 */
export function isPortableRelativePath(value, { allowDot = true } = {}) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  if (allowDot && value === ".") return true;
  return value !== "." && value.split("/").every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}

/**
 * Возвращает проверенный переносимый путь либо бросает предметную ошибку.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {string} label Путь поля для сообщения об ошибке.
 * @param {{allowDot?: boolean}} [options] Разрешить значение `.`.
 * @returns {string} Проверенный путь.
 */
export function assertPortableRelativePath(value, label, options) {
  if (!isPortableRelativePath(value, options)) {
    throw new Error(`${label} должен быть безопасным относительным POSIX-путём`);
  }
  return value;
}
