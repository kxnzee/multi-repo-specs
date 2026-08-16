/** @fileoverview Разбор и строгая проверка конфигурации OpenSpec Orchestrator Alpha. */

import { parse, stringify } from "yaml";

import { assertRepositoryId } from "../shared/schema.js";
import { parseOrchestratorConfigSchema, parseStoreMetadataSchema } from "./schema.js";

const ALPHA_CONTRACT_VERSION = 1;

/**
 * Репозиторий в нормализованном внутреннем формате CLI.
 *
 * @typedef {object} Repository
 * @property {string} id
 * @property {"store" | "code"} role
 * @property {string} remote
 * @property {string} defaultBranch
 */

/**
 * Модель `openspec-orch.yaml` после нормализации.
 *
 * @typedef {object} NormalizedConfig
 * @property {number} version
 * @property {boolean} strict
 * @property {Record<string, unknown>} extensions
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
 * Нормализует одну запись `repositories` из внешнего YAML-формата Alpha v1.
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
  };
  assertRepositoryId(repository.id, `repository-id ${repository.id}`);
  if (repository.remote.startsWith("-") || repository.defaultBranch.startsWith("-")) {
    throw new Error(`Некорректные Git-параметры для repository-id ${repository.id}`);
  }
  if (hasHttpCredentials(repository.remote)) {
    throw new Error(`URL repository-id ${repository.id} содержит credential`);
  }
  return repository;
}

/**
 * Читает и проверяет `openspec-orch.yaml` по строгому контракту Alpha v1.
 * OpenSpec-конфигурацию эта функция намеренно не интерпретирует.
 *
 * @param {string} source Содержимое `openspec-orch.yaml`.
 * @returns {NormalizedConfig} Проверенное runtime-представление.
 */
export function parseOrchestratorConfig(source) {
  const value = parseOrchestratorConfigSchema(
    parseYaml(source, "Некорректный openspec-orch.yaml"),
  );

  const repositories = value.repositories.map(normalizeRepository);
  const ids = new Set(repositories.map(({ id }) => id));
  if (ids.size !== repositories.length) {
    throw new Error("openspec-orch.yaml содержит повторяющийся repository-id");
  }
  const stores = repositories.filter(({ role }) => role === "store");
  if (stores.length !== 1) {
    throw new Error("openspec-orch.yaml должен содержать ровно одну запись roles: [store]");
  }
  return {
    version: value.version,
    strict: value.strict,
    extensions: value.extensions,
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
 * Заполняет встроенный шаблон `openspec-orch.yaml` составом репозиториев Alpha v1.
 * Alpha Core не хранит agent mapping в конфигурации.
 *
 * @param {string} template YAML-шаблон из skeleton.
 * @param {Repository[]} repositories
 * @param {object} [options] Опции сериализации.
 * @param {boolean} [options.strict] Project default для Git-гарантий Core.
 * @param {Record<string, unknown>} [options.extensions] Внешние расширения конфигурации.
 * @returns {string}
 */
export function serializeOrchestratorConfig(template, repositories, { strict = true, extensions = {} } = {}) {
  const value = parseYaml(template, "Некорректный шаблон openspec-orch.yaml");
  if (value.version !== ALPHA_CONTRACT_VERSION) {
    throw new Error(`Шаблон openspec-orch.yaml имеет неподдерживаемую version: ${value.version}`);
  }
  if (typeof strict !== "boolean") throw new Error("strict должен быть boolean");
  const serialized = {
    version: ALPHA_CONTRACT_VERSION,
    strict,
    repositories: repositories.map(({ id, role, remote, defaultBranch }) => ({
      id,
      roles: [role],
      remote,
      default_branch: defaultBranch,
    })),
    extensions: extensions ?? {},
  };
  return stringify(serialized, { lineWidth: 0 });
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
    parseYaml(source, "Некорректная .openspec-store/store.yaml"),
  );
  if (value.version !== ALPHA_CONTRACT_VERSION) throw new Error("Store metadata должна иметь version: 1");
  assertRepositoryId(value.id, "Store ID");
  return { id: value.id, remote: value.remote };
}
