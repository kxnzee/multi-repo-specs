/** @fileoverview Zod-схемы YAML-контрактов OpenSpec Orchestrator. */

import * as z from "zod";

import { CONTRACT_VERSIONS, SERVICE_PATHS } from "./constants.js";
import { PLUGIN_IDS_SCHEMA } from "./plugin.js";
import { PROJECT_SETTINGS } from "./settings.js";

const REPOSITORY_ROLE_SCHEMA = z.enum(["store", "code"]);
const REPOSITORY_FIELDS = {
  id: z.string().min(1),
  roles: z.array(REPOSITORY_ROLE_SCHEMA).length(1),
  remote: z.string().min(1),
  default_branch: z.string().min(1),
};
const REPOSITORY_V1_SCHEMA = z.strictObject(REPOSITORY_FIELDS);
const REPOSITORY_V2_SCHEMA = z.strictObject({
  ...REPOSITORY_FIELDS,
  plugins: PLUGIN_IDS_SCHEMA,
});
const ORCHESTRATOR_CONFIG_V1_SCHEMA = z.strictObject({
  version: z.literal(CONTRACT_VERSIONS.legacyOrchestratorConfig),
  strict: z.boolean().default(PROJECT_SETTINGS.execution.strictByDefault),
  repositories: z.array(REPOSITORY_V1_SCHEMA).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
});
const ORCHESTRATOR_CONFIG_V2_SCHEMA = z.strictObject({
  version: z.literal(CONTRACT_VERSIONS.orchestratorConfig),
  strict: z.boolean().default(PROJECT_SETTINGS.execution.strictByDefault),
  plugins: PLUGIN_IDS_SCHEMA,
  repositories: z.array(REPOSITORY_V2_SCHEMA).default([]),
});
const ORCHESTRATOR_CONFIG_SCHEMA = z.discriminatedUnion("version", [
  ORCHESTRATOR_CONFIG_V1_SCHEMA,
  ORCHESTRATOR_CONFIG_V2_SCHEMA,
]);
const STORE_METADATA_SCHEMA = z.strictObject({
  version: z.number().int(),
  id: z.string().min(1),
  remote: z.string().optional(),
});

/**
 * Разбирает значение по схеме и добавляет название внешнего контракта к ошибке.
 *
 * @param {z.ZodType} schema Runtime-схема.
 * @param {unknown} value Необработанное значение.
 * @param {string} label Заголовок ошибки.
 * @returns {Record<string, unknown>} Проверенное значение.
 */
function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`CONFIG_INVALID: ${label}: ${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * Проверяет строгую структуру `openspec-orch.yaml` до предметной нормализации.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {Record<string, unknown>} Проверенный документ.
 */
export function parseOrchestratorConfigSchema(value) {
  return parseSchema(
    ORCHESTRATOR_CONFIG_SCHEMA,
    value,
    `Некорректный ${SERVICE_PATHS.orchestratorConfig}`,
  );
}

/**
 * Проверяет структуру `.openspec-store/store.yaml`.
 *
 * @param {unknown} value Разобранный YAML.
 * @returns {import("../shared/types.js").StoreMetadata} Проверенный документ.
 */
export function parseStoreMetadataSchema(value) {
  return parseSchema(STORE_METADATA_SCHEMA, value, `Некорректная ${SERVICE_PATHS.storeMetadata}`);
}
