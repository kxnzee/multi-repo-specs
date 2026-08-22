/** @fileoverview Разбор и строгая проверка конфигурации OpenSpec Orchestrator. */

import path from "node:path";
import { parse, stringify } from "yaml";

import { assertRepositoryId } from "../shared/schema.js";
import { CONTRACT_VERSIONS, SERVICE_PATHS } from "./constants.js";
import { assertPluginBindings } from "./plugin.js";
import { parseOrchestratorConfigSchema, parseStoreMetadataSchema } from "./schema.js";
import { PROJECT_SETTINGS } from "./settings.js";

/**
 * Репозиторий в нормализованном внутреннем формате CLI.
 *
 * @typedef {object} Repository
 * @property {string} id
 * @property {"store" | "code"} role
 * @property {string} remote
 * @property {string} defaultBranch
 * @property {string[]} plugins
 */

/**
 * Модель `openspec-orch.yaml` после нормализации.
 *
 * @typedef {object} NormalizedConfig
 * @property {number} version
 * @property {boolean} strict
 * @property {string[]} plugins
 * @property {Record<string, unknown>} extensions Legacy v1 data retained for safe migration checks.
 * @property {Repository[]} repositories
 * @property {Repository} storeRepository
 * @property {Repository[]} codeRepositories
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
    throw new Error(`CONFIG_INVALID: ${label}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CONFIG_INVALID: ${label} должен содержать YAML-объект`);
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
 * Проверяет безопасную форму Git remote контракта.
 *
 * @param {string} remote Git remote.
 * @param {string} repositoryId Repository ID для диагностики.
 * @returns {void}
 */
export function assertRepositoryRemote(remote, repositoryId) {
  let fileUrl = false;
  try {
    fileUrl = new URL(remote).protocol === "file:";
  } catch {
    // SCP-подобные Git remote не являются WHATWG URL и проверяются ниже как строки.
  }
  if (path.posix.isAbsolute(remote) || path.win32.isAbsolute(remote) || fileUrl) {
    throw new Error(`CONFIG_INVALID: remote repository-id ${repositoryId} не должен быть локальным абсолютным путём`);
  }
  if (remote.startsWith("-") || hasHttpCredentials(remote)) {
    throw new Error(`CONFIG_INVALID: некорректный или содержащий credential remote repository-id ${repositoryId}`);
  }
}

/**
 * Нормализует одну запись `repositories` из внешнего YAML-формата.
 *
 * @param {{id: string, roles: Array<"store" | "code">, remote: string, default_branch: string}} value Проверенная схемой запись.
 * @returns {Repository} Проверенная запись во внутреннем формате CLI.
 */
function normalizeRepository(value) {
  const [role] = value.roles;
  const repository = {
    id: value.id,
    role,
    remote: value.remote,
    defaultBranch: value.default_branch,
    plugins: value.plugins ?? [],
  };
  assertRepositoryId(repository.id, `repository-id ${repository.id}`);
  if (repository.defaultBranch.startsWith("-")) {
    throw new Error(`CONFIG_INVALID: некорректные Git-параметры для repository-id ${repository.id}`);
  }
  assertRepositoryRemote(repository.remote, repository.id);
  return repository;
}

/**
 * Читает и проверяет `openspec-orch.yaml` по строгому контракту v1/v2.
 * OpenSpec-конфигурацию эта функция намеренно не интерпретирует.
 *
 * @param {string} source Содержимое `openspec-orch.yaml`.
 * @returns {NormalizedConfig} Проверенное runtime-представление.
 */
export function parseOrchestratorConfig(source) {
  const value = parseOrchestratorConfigSchema(
    parseYaml(source, `Некорректный ${SERVICE_PATHS.orchestratorConfig}`),
  );

  const repositories = value.repositories.map(normalizeRepository);
  const ids = new Set(repositories.map(({ id }) => id));
  if (ids.size !== repositories.length) {
    throw new Error(
      `CONFIG_INVALID: ${SERVICE_PATHS.orchestratorConfig} содержит повторяющийся repository-id`,
    );
  }
  const stores = repositories.filter(({ role }) => role === "store");
  if (stores.length !== 1) {
    throw new Error(
      `CONFIG_INVALID: ${SERVICE_PATHS.orchestratorConfig} должен содержать ` +
        "ровно одну запись roles: [store]",
    );
  }
  const plugins = value.version === CONTRACT_VERSIONS.orchestratorConfig ? value.plugins : [];
  assertPluginBindings(plugins, repositories);
  return {
    version: value.version,
    strict: value.strict,
    plugins,
    extensions: value.version === CONTRACT_VERSIONS.legacyOrchestratorConfig ? value.extensions : {},
    repositories,
    storeRepository: stores[0],
    codeRepositories: repositories.filter(({ role }) => role === "code"),
  };
}

/**
 * Проверяет режим выполнения без скрытого fallback из strict в relaxed.
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
 * Заполняет встроенный шаблон `openspec-orch.yaml` составом репозиториев.
 * Core не хранит agent mapping в конфигурации.
 *
 * @param {string} template Встроенный YAML-шаблон конфигурации.
 * @param {Repository[]} repositories
 * @param {object} [options] Опции сериализации.
 * @param {boolean} [options.strict] Project default для Git-гарантий Core.
 * @param {string[]} [options.plugins] Выбранные Plugins проекта.
 * @returns {string}
 */
export function serializeOrchestratorConfig(
  template,
  repositories,
  { strict = PROJECT_SETTINGS.execution.strictByDefault, plugins = [] } = {},
) {
  const value = parseYaml(template, `Некорректный шаблон ${SERVICE_PATHS.orchestratorConfig}`);
  if (![
    CONTRACT_VERSIONS.legacyOrchestratorConfig,
    CONTRACT_VERSIONS.orchestratorConfig,
  ].includes(value.version)) {
    throw new Error(
      `Шаблон ${SERVICE_PATHS.orchestratorConfig} имеет неподдерживаемую version: ${value.version}`,
    );
  }
  if (typeof strict !== "boolean") throw new Error("strict должен быть boolean");
  const serialized = {
    version: CONTRACT_VERSIONS.orchestratorConfig,
    strict,
    plugins,
    repositories: repositories.map(({ id, role, remote, defaultBranch, plugins: repositoryPlugins = [] }) => ({
      id,
      roles: [role],
      remote,
      default_branch: defaultBranch,
      plugins: repositoryPlugins,
    })),
  };
  const source = stringify(serialized, { lineWidth: 0 });
  parseOrchestratorConfig(source);
  return source;
}

/**
 * Сериализует уже нормализованную конфигурацию после контролируемого изменения Core.
 *
 * @param {NormalizedConfig} config Проверенная конфигурация.
 * @returns {string} YAML-контракт актуальной версии.
 */
export function serializeNormalizedOrchestratorConfig(config) {
  if (Object.keys(config.extensions ?? {}).length > 0) {
    throw new Error(
      "CONFIG_MIGRATION_REQUIRED: непустой extensions из version: 1 нельзя удалить автоматически",
    );
  }
  return serializeOrchestratorConfig(
    `version: ${CONTRACT_VERSIONS.orchestratorConfig}\nrepositories: []\nplugins: []\n`,
    config.repositories,
    { strict: config.strict, plugins: config.plugins },
  );
}

/**
 * Читает минимальную Store identity, нужную адаптеру до вызова OpenSpec.
 * Полную корректность Store проверяют официальные команды register/doctor.
 *
 * @param {string} source Содержимое `.openspec-store/store.yaml`.
 * @returns {{id: string, remote: string | undefined}}
 */
export function parseStoreMetadata(source) {
  const value = parseStoreMetadataSchema(
    parseYaml(source, `Некорректная ${SERVICE_PATHS.storeMetadata}`),
  );
  if (value.version !== CONTRACT_VERSIONS.storeMetadata) {
    throw new Error(
      `CONFIG_INVALID: Store metadata должна иметь version: ${CONTRACT_VERSIONS.storeMetadata}`,
    );
  }
  assertRepositoryId(value.id, "Store ID");
  return { id: value.id, remote: value.remote };
}
