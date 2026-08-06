import { parse, stringify } from "yaml";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = new Set(["store", "code"]);

/**
 * Репозиторий в нормализованном внутреннем формате CLI.
 *
 * @typedef {object} Repository
 * @property {string} id
 * @property {"store" | "code"} role
 * @property {string} url
 * @property {string} defaultBranch
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

function hasHttpCredentials(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {Repository}
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
 * Читает и проверяет принадлежащую SDD часть конфигурации.
 * OpenSpec-конфигурацию эта функция намеренно не интерпретирует.
 *
 * @param {string} source Содержимое sdd.yaml.
 * @returns {{
 *   openSpecVersion: string,
 *   repositories: Repository[],
 *   storeRepository: Repository,
 *   codeRepositories: Repository[]
 * }}
 */
export function parseSddConfig(source) {
  const value = parseYaml(source, "Некорректный sdd.yaml");
  if (typeof value.versions?.openspec !== "string") {
    throw new Error("В sdd.yaml отсутствует versions.openspec");
  }
  if (!Array.isArray(value.repositories)) {
    throw new Error("В sdd.yaml отсутствует список repositories");
  }

  const repositories = value.repositories.map(normalizeRepository);
  const ids = new Set(repositories.map(({ id }) => id));
  if (ids.size !== repositories.length) {
    throw new Error("sdd.yaml содержит повторяющийся repository-id");
  }
  const stores = repositories.filter(({ role }) => role === "store");
  if (stores.length !== 1) {
    throw new Error("sdd.yaml должен содержать ровно одну запись role: store");
  }
  return {
    openSpecVersion: value.versions.openspec,
    repositories,
    storeRepository: stores[0],
    codeRepositories: repositories.filter(({ role }) => role === "code"),
  };
}

/**
 * Заполняет встроенный шаблон sdd.yaml известными репозиториями.
 *
 * @param {string} template YAML-шаблон из skeleton.
 * @param {Repository[]} repositories
 * @returns {string}
 */
export function serializeRepositories(template, repositories) {
  const value = parseYaml(template, "Некорректный шаблон sdd.yaml");
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
  const value = parseYaml(source, "Некорректная .openspec-store/store.yaml");
  if (value.version !== 1) throw new Error("Store metadata должна иметь version: 1");
  assertRepositoryId(value.id, "Store ID");
  if (value.remote !== undefined && typeof value.remote !== "string") {
    throw new Error("Store metadata remote должен быть строкой");
  }
  return { id: value.id, remote: value.remote };
}

/**
 * @param {unknown} id
 * @param {string} [label]
 * @returns {string}
 */
export function assertRepositoryId(id, label = "repository-id") {
  if (!ID_PATTERN.test(id ?? "")) throw new Error(`${label} должен быть в lowercase kebab-case`);
  return id;
}

/**
 * Сравнивает URL без завершающего слеша, не пытаясь переопределять Git-семантику.
 *
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function sameGitRemote(actual, expected) {
  const normalize = (value) => value.trim().replace(/\/+$/, "");
  return normalize(actual) === normalize(expected);
}
