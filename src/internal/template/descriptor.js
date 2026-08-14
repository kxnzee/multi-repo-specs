/** @fileoverview Разбор минимального декларативного контракта Project Template. */

import { parse } from "yaml";
import * as z from "zod";

import {
  assertPortableRelativePath,
  isPortableRelativePath,
} from "../shared/paths.js";
import { isRecord } from "../shared/schema.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARCHITECTURE = "markdown-commands";
const ID_SCHEMA = z.string().regex(ID_PATTERN, "ожидается lowercase kebab-case");

/**
 * Создаёт схему безопасного относительного пути.
 *
 * @param {boolean} allowDot Разрешить корень `.`.
 * @returns {z.ZodString} Zod-схема пути.
 */
function relativePathSchema(allowDot) {
  return z.string().refine(
    (value) => isPortableRelativePath(value, { allowDot }),
    "должен быть безопасным относительным POSIX-путём",
  );
}

const RELATIVE_PATH = relativePathSchema(true);
const NON_ROOT_PATH = relativePathSchema(false);
const COPY_SCHEMA = z.strictObject({ from: RELATIVE_PATH, to: RELATIVE_PATH });
const HANDOFFS_SCHEMA = z.record(z.string(), NON_ROOT_PATH).refine(
  (handoffs) => Object.keys(handoffs).every((name) => ID_PATTERN.test(name)),
  "handoff name должен быть в lowercase kebab-case",
);
const AGENT_SCHEMA = z.strictObject({
  openspec_adapter: ID_SCHEMA,
  generated_directory: NON_ROOT_PATH,
  target_directory: NON_ROOT_PATH,
  commands_directory: NON_ROOT_PATH,
  instructions_file: NON_ROOT_PATH,
  handoffs: HANDOFFS_SCHEMA.default({}),
  copy: z.array(COPY_SCHEMA),
});
const TEMPLATE_SCHEMA = z.strictObject({
  agents: z.record(z.string(), AGENT_SCHEMA).refine(
    (agents) => Object.keys(agents).length > 0,
    "template.yaml должен содержать непустой agents",
  ).refine(
    (agents) => Object.keys(agents).every((id) => ID_PATTERN.test(id)),
    "Agent ID должен быть в lowercase kebab-case",
  ),
});

/**
 * Проверяет безопасный переносимый относительный путь Template.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {string} label Путь поля для сообщения об ошибке.
 * @param {{allowDot?: boolean}} [options] Разрешить корень назначения `.`.
 * @returns {string} Проверенный POSIX-путь.
 */
export function assertTemplateRelativePath(value, label, options) {
  return assertPortableRelativePath(value, label, options);
}

/**
 * Нормализует один проверенный agent mapping.
 *
 * @param {string} id ID агента из ключа `agents`.
 * @param {Record<string, unknown>} value Проверенный mapping.
 * @returns {import("./types.js").TemplateAgent} Нормализованный mapping.
 */
function normalizeAgent(id, value) {
  const generatedDirectory = value.generated_directory;
  const targetDirectory = value.target_directory;
  if (
    generatedDirectory !== targetDirectory &&
    (
      generatedDirectory.startsWith(`${targetDirectory}/`) ||
      targetDirectory.startsWith(`${generatedDirectory}/`)
    )
  ) {
    throw new Error(`agents.${id} не может вкладывать generated_directory и target_directory друг в друга`);
  }
  return {
    id,
    openSpecId: value.openspec_adapter,
    architecture: ARCHITECTURE,
    generatedDirectory,
    targetDirectory,
    commandsDirectory: value.commands_directory,
    instructionsFile: value.instructions_file,
    handoffs: value.handoffs,
    copy: value.copy,
  };
}

/**
 * Разбирает `template.yaml` без package/registry/version semantics.
 *
 * @param {string} source Содержимое descriptor.
 * @returns {import("./types.js").ProjectTemplateDescriptor} Нормализованный descriptor.
 */
export function parseTemplateDescriptor(source) {
  let value;
  try {
    value = parse(source);
  } catch (error) {
    throw new Error(`Некорректный template.yaml: ${error.message}`);
  }
  if (isRecord(value) && isRecord(value.agents)) {
    const invalidId = Object.keys(value.agents).find((id) => !ID_PATTERN.test(id));
    if (invalidId) {
      throw new Error(`Agent ID '${invalidId}' в template.yaml должен быть в lowercase kebab-case`);
    }
  }
  const result = TEMPLATE_SCHEMA.safeParse(value);
  if (!result.success) {
    throw new Error(`Некорректный template.yaml: ${z.prettifyError(result.error)}`);
  }
  return {
    agents: Object.fromEntries(
      Object.entries(result.data.agents).map(([id, agent]) => [id, normalizeAgent(id, agent)]),
    ),
  };
}
