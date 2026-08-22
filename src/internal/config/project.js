/** @fileoverview Доменный facade проекта поверх нормализованного config. */

import { SERVICE_PATHS } from "./constants.js";

/** Рекурсивно блокирует изменение принадлежащего доменной модели snapshot. */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** Создаёт собственный immutable snapshot config и пересчитывает derived views. */
function ownProjectConfig(config) {
  const owned = globalThis.structuredClone(config);
  return deepFreeze({
    ...owned,
    storeRepository: owned.repositories.find(({ role }) => role === "store"),
    codeRepositories: owned.repositories.filter(({ role }) => role === "code"),
  });
}

export class ProjectModel {
  #config;

  constructor(config) {
    this.#config = ownProjectConfig(config);
  }

  get strict() {
    return this.#config.strict;
  }

  get agents() {
    return this.#config.agents;
  }

  get repositories() {
    return this.#config.repositories;
  }

  get storeRepository() {
    return this.#config.storeRepository;
  }

  get codeRepositories() {
    return this.#config.codeRepositories;
  }

  /** Возвращает актуальный immutable config snapshot для сериализации. */
  toConfig() {
    return this.#config;
  }

  /** Возвращает Repository по ID либо `undefined`. */
  repository(repositoryId) {
    return this.repositories.find(({ id }) => id === repositoryId);
  }

  /** Возвращает Repository по ID либо выбрасывает стабильную доменную ошибку. */
  requireRepository(repositoryId) {
    const repository = this.repository(repositoryId);
    if (!repository) {
      throw new Error(
        `REPO_UNKNOWN: repository-id '${repositoryId}' отсутствует в ${SERVICE_PATHS.orchestratorConfig}`,
      );
    }
    return repository;
  }

  /** Выбирает repositories в проектном порядке и проверяет каждый переданный ID. */
  selectRepositories(repositoryIds) {
    if (!repositoryIds || repositoryIds.length === 0) return this.repositories;
    for (const repositoryId of repositoryIds) this.requireRepository(repositoryId);
    const selected = new Set(repositoryIds);
    return this.repositories.filter(({ id }) => selected.has(id));
  }

  /** Проверяет регистрацию Plugin на уровне проекта. */
  hasPlugin(pluginId) {
    return this.#config.plugins.includes(pluginId);
  }

  /** Возвращает зарегистрированный Plugin ID либо стабильную доменную ошибку. */
  requirePlugin(pluginId) {
    if (!this.hasPlugin(pluginId)) {
      throw new Error(`PLUGIN_NOT_INITIALIZED: plugin-id '${pluginId}' не выбран`);
    }
    return pluginId;
  }

  /** Регистрирует Plugins в проекте без изменения repository bindings. */
  registerPlugins(pluginIds) {
    this.#replace({
      plugins: [...new Set([...this.#config.plugins, ...pluginIds])].sort(),
    });
  }

  /** Блокирует автоматическую миграцию непустого legacy extensions при Plugin init. */
  assertPluginInitializationAllowed() {
    if (Object.keys(this.#config.extensions).length > 0) {
      throw new Error(
        "CONFIG_MIGRATION_REQUIRED: перенесите данные из legacy extensions перед инициализацией Plugins",
      );
    }
  }

  /** Проверяет связь Plugin с Repository. */
  isPluginConnected(pluginId, repositoryId) {
    return this.requireRepository(repositoryId).plugins.includes(pluginId);
  }

  /** Добавляет успешные Plugin bindings. */
  connectPlugin(pluginId, repositoryIds) {
    this.requirePlugin(pluginId);
    const selected = new Set(repositoryIds);
    for (const repositoryId of selected) this.requireRepository(repositoryId);
    this.#replace({
      repositories: this.repositories.map((repository) => selected.has(repository.id)
        ? { ...repository, plugins: [...new Set([...repository.plugins, pluginId])].sort() }
        : repository),
    });
  }

  /** Удаляет одну Plugin binding. */
  disconnectPlugin(pluginId, repositoryId) {
    const repository = this.requireRepository(repositoryId);
    if (!repository.plugins.includes(pluginId)) return false;
    this.#replace({
      repositories: this.repositories.map((entry) => entry.id === repositoryId
        ? { ...entry, plugins: entry.plugins.filter((id) => id !== pluginId) }
        : entry),
    });
    return true;
  }

  /** Удаляет Plugin из проекта, если он не связан с repositories. */
  removePlugin(pluginId) {
    if (this.repositories.some(({ plugins }) => plugins.includes(pluginId))) {
      throw new Error(`PLUGIN_CONNECTED: сначала отключите ${pluginId} от всех repositories`);
    }
    if (!this.hasPlugin(pluginId)) return false;
    this.#replace({ plugins: this.#config.plugins.filter((id) => id !== pluginId) });
    return true;
  }

  /** Возвращает Plugin bindings в проектном порядке repositories. */
  pluginConnections({ pluginId, repositoryId } = {}) {
    if (pluginId !== undefined) this.requirePlugin(pluginId);
    if (repositoryId !== undefined) this.requireRepository(repositoryId);
    return this.repositories.flatMap((repository) => repository.plugins
      .filter((currentPluginId) => (
        (!repositoryId || repository.id === repositoryId) &&
        (!pluginId || currentPluginId === pluginId)
      ))
      .map((currentPluginId) => ({ repository, pluginId: currentPluginId })));
  }

  #replace(changes) {
    this.#config = ownProjectConfig({ ...this.#config, ...changes });
  }
}

/** Создаёт общий доменный facade проверенной конфигурации проекта. */
export function createProjectModel(config) {
  return new ProjectModel(config);
}
