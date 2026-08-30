/** @fileoverview Доменный агрегат Project поверх нормализованного config. */

import { CORE_CONTRACT_VERSIONS, CORE_FILES, CORE_PATTERNS } from "./constants.js";
import { ExtensionDeclaration } from "./extension-declaration.js";
import { PluginDeclaration } from "./plugin-declaration.js";
import { Repository } from "./repository.js";
import { deepFreeze } from "./value.js";

/** Project владеет Repository registry и Plugin bindings. */
export class Project {
  #version;
  #strict;
  #template;
  #agent;
  #extensions;
  #plugins;
  #repositories;

  constructor(config) {
    this.#version = config.version;
    this.#strict = config.strict;
    this.#template = Project.#identity(config.template, "Template");
    this.#agent = Project.#identity(config.agent, "Agent");
    this.#extensions = Object.freeze((config.extensions ?? []).map((extension) => (
      extension instanceof ExtensionDeclaration ? extension : new ExtensionDeclaration(extension)
    )));
    this.#plugins = Object.freeze((config.plugins ?? []).map((plugin) => (
      plugin instanceof PluginDeclaration ? plugin : new PluginDeclaration(plugin)
    )));
    this.#repositories = Object.freeze(config.repositories.map((repository) => (
      repository instanceof Repository ? repository : new Repository(repository)
    )));
    this.#assertRegistry();
    Object.freeze(this);
  }

  get version() {
    return this.#version;
  }

  get strict() {
    return this.#strict;
  }

  get template() { return this.#template; }
  get agent() { return this.#agent; }

  get extensions() {
    return Object.freeze(this.#extensions.map(({ id }) => id));
  }

  get extensionDeclarations() { return this.#extensions; }

  get plugins() {
    return Object.freeze(this.#plugins.map(({ id }) => id));
  }

  get pluginDeclarations() {
    return this.#plugins;
  }

  get repositories() {
    return this.#repositories;
  }

  get storeRepository() {
    return this.#repositories.find((repository) => repository.isStore());
  }

  get codeRepositories() {
    return Object.freeze(this.#repositories.filter((repository) => repository.isCode()));
  }

  toConfig() {
    const repositories = this.#repositories.map((repository) => repository.toConfig());
    return deepFreeze({
      version: this.#version,
      strict: this.#strict,
      template: { ...this.#template },
      agent: { ...this.#agent },
      extensions: this.#extensions.map((extension) => extension.toConfig()),
      plugins: this.#plugins.map((plugin) => plugin.toConfig()),
      repositories,
      storeRepository: this.storeRepository.toConfig(),
      codeRepositories: this.codeRepositories.map((repository) => repository.toConfig()),
    });
  }

  repository(repositoryId) {
    return this.#repositories.find(({ id }) => id === repositoryId);
  }

  requireRepository(repositoryId) {
    const repository = this.repository(repositoryId);
    if (!repository) {
      throw new Error(
        `REPO_UNKNOWN: repository-id '${repositoryId}' отсутствует в ${CORE_FILES.orchestratorConfig}`,
      );
    }
    return repository;
  }

  selectRepositories(repositoryIds) {
    if (!repositoryIds || repositoryIds.length === 0) return this.#repositories;
    for (const repositoryId of repositoryIds) this.requireRepository(repositoryId);
    const selected = new Set(repositoryIds);
    return Object.freeze(this.#repositories.filter(({ id }) => selected.has(id)));
  }

  hasPlugin(pluginId) {
    return this.#plugins.some(({ id }) => id === pluginId);
  }

  pluginDeclaration(pluginId) {
    return this.#plugins.find(({ id }) => id === pluginId);
  }

  extensionDeclaration(extensionId) {
    return this.#extensions.find(({ id }) => id === extensionId);
  }

  requireExtension(extensionId) {
    const declaration = this.extensionDeclaration(extensionId);
    if (!declaration) {
      throw new Error(`EXTENSION_NOT_SELECTED: extension-id '${extensionId}' не выбран в Store`);
    }
    return declaration;
  }

  requirePlugin(pluginId) {
    if (!this.hasPlugin(pluginId)) {
      throw new Error(`PLUGIN_NOT_INITIALIZED: plugin-id '${pluginId}' не выбран`);
    }
    return pluginId;
  }

  declarePlugin(pluginId, source) {
    const current = this.pluginDeclaration(pluginId);
    const declaration = new PluginDeclaration({ id: pluginId, source });
    const next = [
      ...this.#plugins.filter(({ id }) => id !== pluginId),
      declaration,
    ].sort((left, right) => left.id.localeCompare(right.id));
    const changed = current?.source !== source;
    this.#plugins = Object.freeze(next);
    return changed;
  }

  isPluginConnected(pluginId, repositoryId) {
    return this.requireRepository(repositoryId).hasPlugin(pluginId);
  }

  connectPlugin(pluginId, repositoryIds) {
    this.requirePlugin(pluginId);
    const selected = new Set(repositoryIds);
    for (const repositoryId of selected) this.requireRepository(repositoryId);
    this.#repositories = Object.freeze(this.#repositories.map((repository) => (
      selected.has(repository.id) ? repository.connectPlugin(pluginId) : repository
    )));
  }

  disconnectPlugin(pluginId, repositoryId) {
    const repository = this.requireRepository(repositoryId);
    if (!repository.hasPlugin(pluginId)) return false;
    this.#repositories = Object.freeze(this.#repositories.map((entry) => (
      entry.id === repositoryId ? entry.disconnectPlugin(pluginId) : entry
    )));
    return true;
  }

  removePlugin(pluginId) {
    if (this.#repositories.some((repository) => repository.hasPlugin(pluginId))) {
      throw new Error(`PLUGIN_CONNECTED: сначала отключите ${pluginId} от всех repositories`);
    }
    const declaration = this.pluginDeclaration(pluginId);
    if (!declaration) return false;
    this.#plugins = Object.freeze(this.#plugins.filter(({ id }) => id !== pluginId));
    return true;
  }

  pluginConnections({ pluginId, repositoryId } = {}) {
    if (pluginId !== undefined) this.requirePlugin(pluginId);
    if (repositoryId !== undefined) this.requireRepository(repositoryId);
    return Object.freeze(this.#repositories.flatMap((repository) => repository.plugins
      .filter((currentPluginId) => (
        (!repositoryId || repository.id === repositoryId) &&
        (!pluginId || currentPluginId === pluginId)
      ))
      .map((currentPluginId) => Object.freeze({ repository, pluginId: currentPluginId }))));
  }

  #assertRegistry() {
    if (this.#version !== CORE_CONTRACT_VERSIONS.project) {
      throw new Error(
        `PROJECT_INVALID: поддерживается только version ${CORE_CONTRACT_VERSIONS.project}`,
      );
    }
    if (new Set(this.#repositories.map(({ id }) => id)).size !== this.#repositories.length) {
      throw new Error("PROJECT_INVALID: repositories содержит повторяющийся ID");
    }
    if (new Set(this.#plugins.map(({ id }) => id)).size !== this.#plugins.length) {
      throw new Error("PROJECT_INVALID: plugins содержит повторяющийся ID");
    }
    if (new Set(this.#extensions.map(({ id }) => id)).size !== this.#extensions.length) {
      throw new Error("PROJECT_INVALID: extensions содержит повторяющийся ID");
    }
    if (this.#repositories.filter((repository) => repository.isStore()).length !== 1) {
      throw new Error("PROJECT_INVALID: Project должен содержать ровно один Store Repository");
    }
    const registered = new Set(this.#plugins.map(({ id }) => id));
    for (const repository of this.#repositories) {
      for (const pluginId of repository.plugins) {
        if (!registered.has(pluginId)) {
          throw new Error(
            `PROJECT_INVALID: Repository ${repository.id} связан с незарегистрированным Plugin ${pluginId}`,
          );
        }
      }
    }
  }

  static #identity(value, label) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).join(",") !== "id" ||
      typeof value.id !== "string" ||
      !CORE_PATTERNS.id.test(value.id)
    ) {
      throw new Error(`PROJECT_INVALID: ${label} должен содержать один корректный id`);
    }
    return Object.freeze({ id: value.id });
  }
}

/** Создаёт Project через публичный функциональный фасад. */
export function createProject(config) {
  return new Project(config);
}
