/** @fileoverview Разбор минимального декларативного контракта Project Template. */

import path from "node:path";

import { parse } from "yaml";

import { isRecord } from "../shared/schema.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARCHITECTURE = "markdown-commands";

/**
 * Проверяет безопасный переносимый относительный путь Template.
 *
 * @param {unknown} value Проверяемое значение.
 * @param {string} label Путь поля для сообщения об ошибке.
 * @param {{allowDot?: boolean}} [options] Разрешить корень назначения `.`.
 * @returns {string} Проверенный POSIX-путь.
 */
export function assertTemplateRelativePath(value, label, { allowDot = true } = {}) {
  if (typeof value !== "string" || !value) {
    throw new Error(`В template.yaml отсутствует ${label}`);
  }
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${label} должен быть безопасным относительным POSIX-путём`);
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => !segment || segment === ".." || segment === ".") &&
    !(allowDot && value === ".")
  ) {
    throw new Error(`${label} должен быть нормализованным относительным POSIX-путём`);
  }
  if (!allowDot && value === ".") {
    throw new Error(`${label} не может указывать на корень проекта`);
  }
  return value;
}

/**
 * Требует непустую строку.
 *
 * @param {Record<string, unknown>} owner Объект-владелец.
 * @param {string} key Имя поля.
 * @param {string} label Полный путь поля.
 * @returns {string} Проверенное значение.
 */
function assertString(owner, key, label) {
  const value = owner[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`В template.yaml отсутствует ${label}`);
  }
  return value;
}

/**
 * Нормализует один agent mapping.
 *
 * @param {string} id ID агента из ключа `agents`.
 * @param {unknown} value Исходное значение mapping.
 * @returns {import("./types.js").TemplateAgent} Проверенный mapping.
 */
function normalizeAgent(id, value) {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Agent ID '${id}' в template.yaml должен быть в lowercase kebab-case`);
  }
  if (!isRecord(value)) throw new Error(`agents.${id} должен быть YAML-объектом`);
  const openSpecId = assertString(value, "openspec_adapter", `agents.${id}.openspec_adapter`);
  if (!ID_PATTERN.test(openSpecId)) {
    throw new Error(`agents.${id}.openspec_adapter должен быть в lowercase kebab-case`);
  }

  const generatedDirectory = assertTemplateRelativePath(
    value.generated_directory,
    `agents.${id}.generated_directory`,
    { allowDot: false },
  );
  const targetDirectory = assertTemplateRelativePath(
    value.target_directory,
    `agents.${id}.target_directory`,
    { allowDot: false },
  );
  const commandsDirectory = assertTemplateRelativePath(
    value.commands_directory,
    `agents.${id}.commands_directory`,
    { allowDot: false },
  );
  const instructionsFile = assertTemplateRelativePath(
    value.instructions_file,
    `agents.${id}.instructions_file`,
    { allowDot: false },
  );

  if (!Array.isArray(value.copy)) {
    throw new Error(`agents.${id}.copy должен быть списком`);
  }
  const copy = value.copy.map((operation, index) => {
    if (!isRecord(operation)) {
      throw new Error(`agents.${id}.copy[${index}] должен быть YAML-объектом`);
    }
    return {
      from: assertTemplateRelativePath(
        operation.from,
        `agents.${id}.copy[${index}].from`,
      ),
      to: assertTemplateRelativePath(operation.to, `agents.${id}.copy[${index}].to`),
    };
  });

  const handoffs = {};
  if (value.handoffs !== undefined) {
    if (!isRecord(value.handoffs)) {
      throw new Error(`agents.${id}.handoffs должен быть YAML-объектом`);
    }
    for (const [name, handoffPath] of Object.entries(value.handoffs)) {
      if (!ID_PATTERN.test(name)) {
        throw new Error(`agents.${id}.handoffs содержит некорректное имя '${name}'`);
      }
      handoffs[name] = assertTemplateRelativePath(
        handoffPath,
        `agents.${id}.handoffs.${name}`,
        { allowDot: false },
      );
    }
  }

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
    openSpecId,
    architecture: ARCHITECTURE,
    generatedDirectory,
    targetDirectory,
    commandsDirectory,
    instructionsFile,
    handoffs,
    copy,
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
  if (!isRecord(value)) throw new Error("template.yaml должен содержать YAML-объект");
  if (!isRecord(value.agents) || Object.keys(value.agents).length === 0) {
    throw new Error("template.yaml должен содержать непустой agents");
  }

  const agents = {};
  for (const [id, agent] of Object.entries(value.agents)) {
    agents[id] = normalizeAgent(id, agent);
  }
  return { agents };
}
