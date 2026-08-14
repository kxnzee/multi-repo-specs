/** @fileoverview Разбор и строгая проверка принадлежащей OpenSpec Orchestrator конфигурации. */

import path from "node:path";

import { parse, stringify } from "yaml";
import { assertOrchestratorConfigSchema, assertStoreMetadataSchema } from "./schema.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = new Set(["store", "code"]);
const AGENT_ARCHITECTURE = "markdown-commands";
export const OPEN_SPEC_VERSION = "1.7.0";

/**
 * Репозиторий в нормализованном внутреннем формате CLI.
 *
 * @typedef {object} Repository
 * @property {string} id
 * @property {"store" | "code"} role
 * @property {string} url
 * @property {string} defaultBranch
 */

/**
 * Разбирает YAML и требует объект верхнего уровня.
 *
 * @param {string} source Исходный YAML.
 * @param {string} label Название источника для сообщения об ошибке.
 * @returns {Record<string, unknown>} Разобранный YAML-объект.
 */
function parseYaml(source, label) {
  let value;
  try {
    value = parse(source);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} должен содержать YAML-объект`);
  }
  return value;
}

/**
 * Проверяет, содержит ли HTTP(S)-URL встроенные логин или пароль.
 *
 * @param {string} value Проверяемый Git URL.
 * @returns {boolean} `true`, если credential встроен непосредственно в URL.
 */
function hasHttpCredentials(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

/**
 * Нормализует одну запись repositories из внешнего YAML-формата.
 *
 * @param {unknown} value Необработанная запись из openspec-orch.yaml.
 * @returns {Repository} Проверенная запись во внутреннем формате CLI.
 */
function normalizeRepository(value) {
  const repository = {
    id: value?.id,
    role: value?.role,
    url: value?.url,
    defaultBranch: value?.default_branch,
  };
  assertRepositoryId(repository.id);
  if (!ROLES.has(repository.role)) {
    throw new Error(`Для repository-id ${repository.id} требуется role: store или role: code`);
  }
  if (typeof repository.url !== "string" || typeof repository.defaultBranch !== "string") {
    throw new Error(`Для repository-id ${repository.id} требуются url и default_branch`);
  }
  if (repository.url.startsWith("-") || repository.defaultBranch.startsWith("-")) {
    throw new Error(`Некорректные Git-параметры для repository-id ${repository.id}`);
  }
  if (hasHttpCredentials(repository.url)) {
    throw new Error(`URL repository-id ${repository.id} содержит credential`);
  }
  return repository;
}

/**
 * Проверяет безопасный относительный POSIX-путь, сохранённый Project Template.
 *
 * @param {unknown} value Значение из openspec-orch.yaml.
 * @param {string} label Полный путь поля.
 * @returns {string} Проверенный путь.
 */
function normalizeAgentPath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} должен быть безопасным относительным POSIX-путём`);
  }
  return value;
}

/**
 * Нормализует runtime mapping агента без обращения к исходному Template.
 *
 * @param {Record<string, unknown>} value Agent mapping из YAML.
 * @returns {{id: string, openSpecId: string, architecture: "markdown-commands", commandsDirectory: string, instructionsFile: string, handoffs: Record<string, string>}}
 */
function normalizeAgent(value) {
  const id = assertRepositoryId(value.id, "agent.id");
  const openSpecId = assertRepositoryId(value.openspec_adapter, "agent.openspec_adapter");
  if (value.architecture !== AGENT_ARCHITECTURE) {
    throw new Error(`Неподдерживаемая agent.architecture: ${value.architecture}`);
  }
  const handoffs = {};
  for (const [name, handoffPath] of Object.entries(value.handoffs ?? {})) {
    assertRepositoryId(name, `agent.handoffs.${name}`);
    handoffs[name] = normalizeAgentPath(handoffPath, `agent.handoffs.${name}`);
  }
  return {
    id,
    openSpecId,
    architecture: AGENT_ARCHITECTURE,
    commandsDirectory: normalizeAgentPath(value.commands_directory, "agent.commands_directory"),
    instructionsFile: normalizeAgentPath(value.instructions_file, "agent.instructions_file"),
    handoffs,
  };
}

/**
 * Читает и проверяет принадлежащую OpenSpec Orchestrator часть конфигурации.
 * OpenSpec-конфигурацию эта функция намеренно не интерпретирует.
 *
 * @param {string} source Содержимое openspec-orch.yaml.
 * @returns {{
 *   openSpecVersion: string,
 *   agent: ReturnType<typeof normalizeAgent>,
 *   repositories: Repository[],
 *   storeRepository: Repository,
 *   codeRepositories: Repository[]
 * }}
 */
export function parseOrchestratorConfig(source) {
  const value = parseYaml(source, "Некорректный openspec-orch.yaml");
  assertOrchestratorConfigSchema(value);

  const agent = normalizeAgent(value.agent);

  const repositories = value.repositories.map(normalizeRepository);
  const ids = new Set(repositories.map(({ id }) => id));
  if (ids.size !== repositories.length) {
    throw new Error("openspec-orch.yaml содержит повторяющийся repository-id");
  }
  const stores = repositories.filter(({ role }) => role === "store");
  if (stores.length !== 1) {
    throw new Error("openspec-orch.yaml должен содержать ровно одну запись role: store");
  }
  return {
    openSpecVersion: value.versions.openspec,
    agent,
    repositories,
    storeRepository: stores[0],
    codeRepositories: repositories.filter(({ role }) => role === "code"),
  };
}

/**
 * Заполняет встроенный шаблон openspec-orch.yaml выбранным агентом и репозиториями.
 *
 * @param {string} template YAML-шаблон из skeleton.
 * @param {Repository[]} repositories
 * @param {{id: string, openSpecId: string, architecture: string, commandsDirectory: string, instructionsFile: string, handoffs?: Record<string, string>}} agent
 * @param {string} [openSpecVersion] Версия OpenSpec, которую требуется зафиксировать.
 * @returns {string}
 */
export function serializeOrchestratorConfig(template, repositories, agent, openSpecVersion) {
  const value = parseYaml(template, "Некорректный шаблон openspec-orch.yaml");
  value.versions ??= {};
  value.versions.openspec = assertSupportedOpenSpecVersion(
    openSpecVersion ?? value.versions.openspec,
  );
  value.agent = {
    id: agent.id,
    openspec_adapter: agent.openSpecId,
    architecture: agent.architecture,
    commands_directory: agent.commandsDirectory,
    instructions_file: agent.instructionsFile,
  };
  if (agent.handoffs && Object.keys(agent.handoffs).length > 0) {
    value.agent.handoffs = agent.handoffs;
  }
  value.repositories = repositories.map(({ id, role, url, defaultBranch }) => ({
    id,
    role,
    url,
    default_branch: defaultBranch,
  }));
  return stringify(value, { lineWidth: 0 });
}

/**
 * Проверяет закреплённую версию OpenSpec.
 *
 * @param {unknown} version
 * @returns {string}
 */
export function assertSupportedOpenSpecVersion(version) {
  if (version !== OPEN_SPEC_VERSION) {
    throw new Error(`OpenSpec Orchestrator требует OpenSpec ${OPEN_SPEC_VERSION}`);
  }
  return version;
}

/**
 * Читает минимальную Store identity, нужную адаптеру до вызова OpenSpec.
 * Полную корректность Store проверяют официальные команды register/doctor.
 *
 * @param {string} source Содержимое .openspec-store/store.yaml.
 * @returns {{id: string, remote: string | undefined}}
 */
export function parseStoreMetadata(source) {
  const value = parseYaml(source, "Некорректная .openspec-store/store.yaml");
  assertStoreMetadataSchema(value);
  if (value.version !== 1) throw new Error("Store metadata должна иметь version: 1");
  assertRepositoryId(value.id, "Store ID");
  if (value.remote !== undefined && typeof value.remote !== "string") {
    throw new Error("Store metadata remote должен быть строкой");
  }
  return { id: value.id, remote: value.remote };
}

/**
 * Проверяет устойчивый ID Store или репозитория.
 *
 * @param {unknown} id Проверяемое значение.
 * @param {string} [label] Название поля для сообщения об ошибке.
 * @returns {string} Проверенный lowercase kebab-case ID.
 */
export function assertRepositoryId(id, label = "repository-id") {
  if (!ID_PATTERN.test(id ?? "")) throw new Error(`${label} должен быть в lowercase kebab-case`);
  return id;
}

/**
 * Убирает незначимые завершающие слеши из Git URL перед сравнением.
 *
 * @param {string} value Git URL.
 * @returns {string} Нормализованный URL.
 */
function normalizeGitRemote(value) {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Сравнивает URL без завершающего слеша, не пытаясь переопределять Git-семантику.
 *
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function sameGitRemote(actual, expected) {
  return normalizeGitRemote(actual) === normalizeGitRemote(expected);
}
