/** @fileoverview Runtime guards для недоверенных машинных данных. */

/**
 * Проверяет, что значение является обычным JSON-объектом.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is Record<string, unknown>} Результат проверки.
 */
export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Проверяет обязательную identity OpenSpec root.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is import("./types.js").OpenSpecRoot} Результат проверки.
 */
export function isOpenSpecRoot(value) {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.store_id === undefined || typeof value.store_id === "string") &&
    typeof value.source === "string" &&
    (value.healthy === undefined || typeof value.healthy === "boolean")
  );
}

/**
 * Проверяет форму одной диагностики OpenSpec.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is import("./types.js").OpenSpecDiagnostic} Результат проверки.
 */
export function isOpenSpecDiagnostic(value) {
  return (
    isRecord(value) &&
    (value.code === undefined || typeof value.code === "string") &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.severity === undefined || ["error", "warning", "info"].includes(value.severity))
  );
}

/**
 * Проверяет общую форму машинного ответа OpenSpec.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is import("./types.js").OpenSpecResponse} Результат проверки.
 */
export function isOpenSpecResponse(value) {
  return (
    isRecord(value) &&
    (value.root === undefined || isOpenSpecRoot(value.root)) &&
    (value.status === undefined || Array.isArray(value.status))
  );
}

/**
 * Проверяет полную Git SHA-1 ревизию.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is string} Результат проверки.
 */
export function isGitRevision(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}
