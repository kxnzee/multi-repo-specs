/** @fileoverview Разбор и строгая проверка принадлежащей OpenSpec Orchestrator конфигурации. */

import { parse, stringify } from "yaml";
import { assertPortableRelativePath } from "../shared/paths.js";
import { assertRepositoryId } from "../shared/schema.js";
import { parseOrchestratorConfigSchema, parseStoreMetadataSchema } from "./schema.js";

const ROLES = new Set(["store", "code"]);
const AGENT_ARCHITECTURE = "markdown-commands";

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
  if (repository.url.startsWith("-") || repository.defaultBranch.startsWith("-")) {
    throw new Error(`Некорректные Git-параметры для repository-id ${repository.id}`);
  }
  if (hasHttpCredentials(repository.url)) {
    throw new Error(`URL repository-id ${repository.id} содержит credential`);
  }
  return repository;
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
    handoffs[name] = assertPortableRelativePath(
      handoffPath,
      `agent.handoffs.${name}`,
      { allowDot: false },
    );
  }
  return {
    id,
    openSpecId,
    architecture: AGENT_ARCHITECTURE,
    commandsDirectory: assertPortableRelativePath(
      value.commands_directory,
      "agent.commands_directory",
      { allowDot: false },
    ),
    instructionsFile: assertPortableRelativePath(
      value.instructions_file,
      "agent.instructions_file",
      { allowDot: false },
    ),
    handoffs,
  };
}

/**
 * Читает и проверяет принадлежащую OpenSpec Orchestrator часть конфигурации.
 * OpenSpec-конфигурацию эта функция намеренно не интерпретирует.
 *
 * @param {string} source Содержимое openspec-orch.yaml.
 * @returns {{
 *   strict: boolean,
 *   agent: ReturnType<typeof normalizeAgent>,
 *   repositories: Repository[],
 *   storeRepository: Repository,
 *   codeRepositories: Repository[]
 * }}
 */
export function parseOrchestratorConfig(source) {
  const value = parseOrchestratorConfigSchema(
    parseYaml(source, "Некорректный openspec-orch.yaml"),
  );

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
    strict: value.strict ?? true,
    agent,
    repositories,
    storeRepository: stores[0],
    codeRepositories: repositories.filter(({ role }) => role === "code"),
  };
}

/**
 * Возвращает объявленный Template handoff только в момент вызова зависящей команды.
 *
 * @param {{handoffs: Record<string, string>}} agent Runtime mapping агента.
 * @param {string} name Имя handoff.
 * @param {string} command Пользовательская Core-команда для диагностики.
 * @returns {string} Безопасный относительный путь handoff.
 */
export function requireAgentHandoff(agent, name, command) {
  const handoff = agent.handoffs[name];
  if (!handoff) {
    throw new Error(
      `Project Template не объявил agent.handoffs.${name} для ${command}`,
    );
  }
  return handoff;
}

/**
 * Разрешает режим выполнения без скрытого fallback из strict в relaxed.
 *
 * @param {boolean} projectStrict
 * @param {boolean} noStrict
 * @returns {"strict" | "relaxed"}
 */
export function resolveExecutionMode(projectStrict, noStrict = false) {
  if (typeof projectStrict !== "boolean" || typeof noStrict !== "boolean") {
    throw new Error("Некорректная конфигурация execution mode");
  }
  return noStrict || !projectStrict ? "relaxed" : "strict";
}

/**
 * Заполняет встроенный шаблон openspec-orch.yaml выбранным агентом и репозиториями.
 *
 * @param {string} template YAML-шаблон из skeleton.
 * @param {Repository[]} repositories
 * @param {{id: string, openSpecId: string, architecture: string, commandsDirectory: string, instructionsFile: string, handoffs?: Record<string, string>}} agent
 * @param {boolean} [strict] Project default для Git-гарантий Core.
 * @returns {string}
 */
export function serializeOrchestratorConfig(template, repositories, agent, strict = true) {
  const value = parseYaml(template, "Некорректный шаблон openspec-orch.yaml");
  if (typeof strict !== "boolean") throw new Error("strict должен быть boolean");
  delete value.versions;
  value.strict = strict;
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
 * Читает минимальную Store identity, нужную адаптеру до вызова OpenSpec.
 * Полную корректность Store проверяют официальные команды register/doctor.
 *
 * @param {string} source Содержимое .openspec-store/store.yaml.
 * @returns {{id: string, remote: string | undefined}}
 */
export function parseStoreMetadata(source) {
  const value = parseStoreMetadataSchema(
    parseYaml(source, "Некорректная .openspec-store/store.yaml"),
  );
  if (value.version !== 1) throw new Error("Store metadata должна иметь version: 1");
  assertRepositoryId(value.id, "Store ID");
  return { id: value.id, remote: value.remote };
}
