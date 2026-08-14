/** @fileoverview Runtime-проверка YAML-схем, принадлежащих OpenSpec Orchestrator. */

import { isRecord } from "../shared/schema.js";

/**
 * Проверяет обязательную строку в YAML-объекте.
 *
 * @param {Record<string, unknown>} value Объект-владелец поля.
 * @param {string} key Имя поля.
 * @param {string} label Полный путь для сообщения об ошибке.
 * @returns {void}
 */
function assertString(value, key, label) {
  if (typeof value[key] !== "string" || !value[key]) {
    throw new Error(`В openspec-orch.yaml отсутствует ${label}`);
  }
}

/**
 * Проверяет обязательную структуру openspec-orch.yaml до нормализации значений.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {asserts value is Record<string, unknown>} Успешная проверка структуры.
 */
export function assertOrchestratorConfigSchema(value) {
  if (!isRecord(value)) throw new Error("Некорректный openspec-orch.yaml должен содержать YAML-объект");
  if (!isRecord(value.versions) || typeof value.versions.openspec !== "string") {
    throw new Error("В openspec-orch.yaml отсутствует versions.openspec");
  }
  if (!isRecord(value.agent)) throw new Error("В openspec-orch.yaml отсутствует agent");
  for (const key of [
    "id",
    "openspec_adapter",
    "architecture",
    "commands_directory",
    "instructions_file",
  ]) {
    assertString(value.agent, key, `agent.${key}`);
  }
  if (value.agent.handoffs !== undefined) {
    if (!isRecord(value.agent.handoffs)) {
      throw new Error("agent.handoffs в openspec-orch.yaml должен быть YAML-объектом");
    }
    for (const key of Object.keys(value.agent.handoffs)) {
      assertString(value.agent.handoffs, key, `agent.handoffs.${key}`);
    }
  }
  if (!Array.isArray(value.repositories)) {
    throw new Error("В openspec-orch.yaml отсутствует список repositories");
  }
  for (const [index, repository] of value.repositories.entries()) {
    if (!isRecord(repository)) {
      throw new Error(`repositories[${index}] должен быть YAML-объектом`);
    }
    for (const key of ["id", "role", "url", "default_branch"]) {
      assertString(repository, key, `repositories[${index}].${key}`);
    }
  }
}

/**
 * Проверяет структуру `.openspec-store/store.yaml`.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {asserts value is import("../shared/types.js").StoreMetadata} Успешная проверка.
 */
export function assertStoreMetadataSchema(value) {
  if (!isRecord(value)) {
    throw new Error("Некорректная .openspec-store/store.yaml должна содержать YAML-объект");
  }
  if (typeof value.version !== "number") throw new Error("Store metadata должна содержать version");
  if (typeof value.id !== "string") throw new Error("Store metadata должна содержать id");
  if (value.remote !== undefined && typeof value.remote !== "string") {
    throw new Error("Store metadata remote должен быть строкой");
  }
}
