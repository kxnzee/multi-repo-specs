/** @fileoverview Zod guards для недоверенных машинных данных. */

import * as z from "zod";

const OPEN_SPEC_ROOT_SCHEMA = z.looseObject({
  path: z.string(),
  store_id: z.string().optional(),
  source: z.string(),
  healthy: z.boolean().optional(),
});
const OPEN_SPEC_DIAGNOSTIC_SCHEMA = z.looseObject({
  code: z.string().optional(),
  message: z.string().optional(),
  severity: z.enum(["error", "warning", "info"]).optional(),
});
const OPEN_SPEC_RESPONSE_SCHEMA = z.looseObject({
  root: OPEN_SPEC_ROOT_SCHEMA.optional(),
  status: z.array(z.unknown()).optional(),
});
const GIT_REVISION_SCHEMA = z.string().regex(/^[0-9a-f]{40}$/);

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
  return OPEN_SPEC_ROOT_SCHEMA.safeParse(value).success;
}

/**
 * Проверяет форму одной диагностики OpenSpec.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is import("./types.js").OpenSpecDiagnostic} Результат проверки.
 */
export function isOpenSpecDiagnostic(value) {
  return OPEN_SPEC_DIAGNOSTIC_SCHEMA.safeParse(value).success;
}

/**
 * Проверяет общую форму машинного ответа OpenSpec.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is import("./types.js").OpenSpecResponse} Результат проверки.
 */
export function isOpenSpecResponse(value) {
  return OPEN_SPEC_RESPONSE_SCHEMA.safeParse(value).success;
}

/**
 * Проверяет полную Git SHA-1 ревизию.
 *
 * @param {unknown} value Проверяемое значение.
 * @returns {value is string} Результат проверки.
 */
export function isGitRevision(value) {
  return GIT_REVISION_SCHEMA.safeParse(value).success;
}
