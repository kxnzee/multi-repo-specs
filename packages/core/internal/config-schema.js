/** @fileoverview Транспортные Zod-схемы Core configuration. */

import * as z from "zod";

import { CORE_CONTRACT_VERSIONS, CORE_FILES, CORE_PATTERNS } from "./constants.js";

const ID_SCHEMA = z.string().regex(CORE_PATTERNS.id, "должен быть в lowercase kebab-case");
const ID_LIST_SCHEMA = z.array(ID_SCHEMA).default([]);
const UNIQUE_AGENT_IDS_SCHEMA = ID_LIST_SCHEMA.superRefine((agents, context) => {
  if (new Set(agents).size !== agents.length) {
    context.addIssue({ code: "custom", message: "agents содержит повторяющийся agent-id" });
  }
});
const REPOSITORY_FIELDS = {
  id: ID_SCHEMA,
  roles: z.array(z.enum(["store", "code"])).length(1),
  remote: z.string().min(1),
  default_branch: z.string().min(1),
};
const LEGACY_REPOSITORY_SCHEMA = z.strictObject(REPOSITORY_FIELDS);
const REPOSITORY_SCHEMA = z.strictObject({
  ...REPOSITORY_FIELDS,
  plugins: ID_LIST_SCHEMA,
});
const LEGACY_PROJECT_SCHEMA = z.strictObject({
  version: z.literal(CORE_CONTRACT_VERSIONS.legacyProject),
  strict: z.boolean().default(true),
  repositories: z.array(LEGACY_REPOSITORY_SCHEMA).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
});
const PROJECT_SCHEMA = z.strictObject({
  version: z.literal(CORE_CONTRACT_VERSIONS.project),
  strict: z.boolean().default(true),
  agents: UNIQUE_AGENT_IDS_SCHEMA,
  plugins: ID_LIST_SCHEMA,
  repositories: z.array(REPOSITORY_SCHEMA).default([]),
});
const PROJECT_CONFIG_SCHEMA = z.discriminatedUnion("version", [
  LEGACY_PROJECT_SCHEMA,
  PROJECT_SCHEMA,
]);
const STORE_METADATA_SCHEMA = z.strictObject({
  version: z.number().int(),
  id: ID_SCHEMA,
  remote: z.string().optional(),
});

/** Разбирает transport value и добавляет имя файла к ошибке. */
function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`CONFIG_INVALID: ${label}: ${z.prettifyError(result.error)}`);
  return result.data;
}

/** Проверяет внешний объект openspec-orch.yaml. */
export function parseProjectConfigSchema(value) {
  return parseSchema(PROJECT_CONFIG_SCHEMA, value, `Некорректный ${CORE_FILES.orchestratorConfig}`);
}

/** Проверяет внешний объект Store metadata. */
export function parseStoreMetadataSchema(value) {
  return parseSchema(STORE_METADATA_SCHEMA, value, `Некорректная ${CORE_FILES.storeMetadata}`);
}
