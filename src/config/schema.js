/** @fileoverview Zod-схемы YAML-контрактов OpenSpec Orchestrator. */

import * as z from "zod";

const REQUIRED_STRING = z.string().min(1);
const AGENT_SCHEMA = z.looseObject({
  id: REQUIRED_STRING,
  openspec_adapter: REQUIRED_STRING,
  architecture: REQUIRED_STRING,
  commands_directory: REQUIRED_STRING,
  instructions_file: REQUIRED_STRING,
  handoffs: z.record(z.string(), REQUIRED_STRING).optional(),
});
const REPOSITORY_SCHEMA = z.looseObject({
  id: REQUIRED_STRING,
  role: REQUIRED_STRING,
  url: REQUIRED_STRING,
  default_branch: REQUIRED_STRING,
});
const ORCHESTRATOR_CONFIG_SCHEMA = z.looseObject({
  strict: z.boolean().optional(),
  versions: z.looseObject({ openspec: z.string().optional() }).optional(),
  agent: AGENT_SCHEMA,
  repositories: z.array(REPOSITORY_SCHEMA),
});
const STORE_METADATA_SCHEMA = z.looseObject({
  version: z.number(),
  id: z.string(),
  remote: z.string().optional(),
});

/**
 * Разбирает значение по схеме и добавляет название внешнего контракта к ошибке.
 *
 * @param {z.ZodType} schema Runtime-схема.
 * @param {unknown} value Необработанное значение.
 * @param {string} label Название контракта.
 * @returns {Record<string, unknown>} Проверенное значение.
 */
function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${label}: ${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * Проверяет структуру `openspec-orch.yaml` до предметной нормализации.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {Record<string, unknown>} Проверенный документ.
 */
export function parseOrchestratorConfigSchema(value) {
  return parseSchema(ORCHESTRATOR_CONFIG_SCHEMA, value, "Некорректный openspec-orch.yaml");
}

/**
 * Проверяет структуру `.openspec-store/store.yaml`.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {import("../shared/types.js").StoreMetadata} Проверенный документ.
 */
export function parseStoreMetadataSchema(value) {
  return parseSchema(STORE_METADATA_SCHEMA, value, "Некорректная .openspec-store/store.yaml");
}
