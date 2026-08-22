/** @fileoverview Публичный facade преобразования Core YAML в доменные модели. */

import path from "node:path";

import { parse, stringify } from "yaml";

import { parseProjectConfigSchema, parseStoreMetadataSchema } from "./config-schema.js";
import { CORE_CONTRACT_VERSIONS, CORE_FILES } from "./constants.js";
import { Project } from "./project.js";
import { Store } from "./store.js";

/** Разбирает YAML и требует object верхнего уровня. */
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

/** Проверяет HTTP(S) credentials внутри Git remote. */
function hasHttpCredentials(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

/** Проверяет безопасную форму Git remote внешнего контракта. */
function assertRepositoryRemote(remote, repositoryId) {
  let fileUrl = false;
  try {
    fileUrl = new URL(remote).protocol === "file:";
  } catch {
    // SCP-подобные Git remote не являются WHATWG URL и остаются допустимыми.
  }
  if (path.posix.isAbsolute(remote) || path.win32.isAbsolute(remote) || fileUrl) {
    throw new Error(
      `CONFIG_INVALID: remote repository-id ${repositoryId} не должен быть локальным абсолютным путём`,
    );
  }
  if (remote.startsWith("-") || hasHttpCredentials(remote)) {
    throw new Error(
      `CONFIG_INVALID: некорректный или содержащий credential remote repository-id ${repositoryId}`,
    );
  }
}

/** Нормализует проверенную transport-запись Repository. */
function normalizeRepository(value) {
  const repository = {
    id: value.id,
    role: value.roles[0],
    remote: value.remote,
    defaultBranch: value.default_branch,
    plugins: value.plugins ?? [],
  };
  if (repository.defaultBranch.startsWith("-")) {
    throw new Error(
      `CONFIG_INVALID: некорректные Git-параметры для repository-id ${repository.id}`,
    );
  }
  assertRepositoryRemote(repository.remote, repository.id);
  return repository;
}

/** Проверяет project-wide identity и Plugin binding invariants внешнего YAML. */
function assertProjectContract(plugins, repositories) {
  if (new Set(repositories.map(({ id }) => id)).size !== repositories.length) {
    throw new Error(
      `CONFIG_INVALID: ${CORE_FILES.orchestratorConfig} содержит повторяющийся repository-id`,
    );
  }
  if (repositories.filter(({ role }) => role === "store").length !== 1) {
    throw new Error(
      `CONFIG_INVALID: ${CORE_FILES.orchestratorConfig} должен содержать ` +
        "ровно одну запись roles: [store]",
    );
  }
  if (new Set(plugins).size !== plugins.length) {
    throw new Error("CONFIG_INVALID: plugins содержит повторяющийся plugin-id");
  }
  const knownPlugins = new Set(plugins);
  for (const repository of repositories) {
    if (new Set(repository.plugins).size !== repository.plugins.length) {
      throw new Error(
        `CONFIG_INVALID: repository-id ${repository.id} содержит повторяющийся plugin-id`,
      );
    }
    for (const pluginId of repository.plugins) {
      if (!knownPlugins.has(pluginId)) {
        throw new Error(
          `CONFIG_INVALID: repository-id ${repository.id} ` +
            `ссылается на необъявленный plugin-id ${pluginId}`,
        );
      }
    }
  }
}

/** API трансляции внешних Core contracts в Project и Store. */
export class CoreConfiguration {
  parseProject(source) {
    const value = parseProjectConfigSchema(
      parseYaml(source, `Некорректный ${CORE_FILES.orchestratorConfig}`),
    );
    const repositories = value.repositories.map(normalizeRepository);
    const current = value.version === CORE_CONTRACT_VERSIONS.project;
    const plugins = current ? value.plugins : [];
    assertProjectContract(plugins, repositories);
    return new Project({
      version: value.version,
      strict: value.strict,
      agents: current ? value.agents : [],
      plugins,
      extensions: current ? {} : value.extensions,
      repositories,
    });
  }

  serializeProject(project) {
    const config = project.toConfig();
    if (Object.keys(config.extensions).length > 0) {
      throw new Error(
        "CONFIG_MIGRATION_REQUIRED: непустой extensions из version: 1 нельзя удалить автоматически",
      );
    }
    const source = stringify({
      version: CORE_CONTRACT_VERSIONS.project,
      strict: config.strict,
      agents: config.agents,
      plugins: config.plugins,
      repositories: config.repositories.map((repository) => ({
        id: repository.id,
        roles: [repository.role],
        remote: repository.remote,
        default_branch: repository.defaultBranch,
        plugins: repository.plugins,
      })),
    }, { lineWidth: 0 });
    this.parseProject(source);
    return source;
  }

  parseStore(source) {
    const value = parseStoreMetadataSchema(
      parseYaml(source, `Некорректная ${CORE_FILES.storeMetadata}`),
    );
    if (value.version !== CORE_CONTRACT_VERSIONS.store) {
      throw new Error(
        `CONFIG_INVALID: Store metadata должна иметь version: ${CORE_CONTRACT_VERSIONS.store}`,
      );
    }
    return new Store({ id: value.id, remote: value.remote });
  }
}

/** Общий immutable configuration facade нового Core. */
export const configuration = Object.freeze(new CoreConfiguration());
