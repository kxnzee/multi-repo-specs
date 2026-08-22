/** @fileoverview Fail-fast registry и repository lifecycle dispatch Plugins. */

import { pluginContexts } from "./plugin-context.js";
import { LoadedPlugin } from "./plugin-loader.js";

/** Immutable registry загруженных Plugins с независимым от загрузки порядком. */
export class PluginRegistry {
  #plugins;

  constructor(plugins = []) {
    if (!Array.isArray(plugins) || plugins.some((plugin) => !(plugin instanceof LoadedPlugin))) {
      throw new Error("PLUGIN_REGISTRY_INVALID: требуется массив LoadedPlugin");
    }
    const ids = plugins.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("PLUGIN_REGISTRY_INVALID: plugin IDs не должны повторяться");
    }
    this.#plugins = new Map([...plugins]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((plugin) => [plugin.id, plugin]));
    Object.freeze(this);
  }

  list() {
    return Object.freeze([...this.#plugins.values()]);
  }

  require(pluginId) {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) throw new Error(`PLUGIN_NOT_LOADED: plugin-id '${pluginId}' не загружен`);
    return plugin;
  }
}

/**
 * Выполняет callbacks только после Loader, registry и context checks.
 * Сохранение binding после успешного connect принадлежит application service.
 */
export class PluginHost {
  #contexts;
  #registry;

  constructor({ contextFactory = pluginContexts, registry } = {}) {
    if (!(registry instanceof PluginRegistry)) {
      throw new Error("PLUGIN_HOST_INVALID: требуется PluginRegistry");
    }
    if (
      !contextFactory ||
      typeof contextFactory.forRepository !== "function" ||
      typeof contextFactory.forRepositorySetup !== "function"
    ) {
      throw new Error("PLUGIN_HOST_INVALID: требуется PluginContextFactory");
    }
    this.#contexts = contextFactory;
    this.#registry = registry;
    Object.freeze(this);
  }

  connect(options) {
    return this.#invoke("connect", options);
  }

  assertLoaded(pluginId) {
    this.#registry.require(pluginId);
  }

  status(options) {
    return this.#invoke("status", options);
  }

  sync(options) {
    return this.#invoke("sync", options);
  }

  async #invoke(operation, { pluginId, storeProject, repositoryId } = {}) {
    const loadedPlugin = this.#registry.require(pluginId);
    const { plugin } = loadedPlugin;
    const hasRepositoryContribution = plugin.hasRepositoryContribution();
    if (typeof hasRepositoryContribution !== "boolean") {
      throw new Error(
        `PLUGIN_CONTRACT_INVALID: ${plugin.id}.hasRepositoryContribution должен вернуть boolean`,
      );
    }
    if (!hasRepositoryContribution) {
      throw new Error(
        `PLUGIN_REPOSITORY_UNSUPPORTED: ${plugin.id} не предоставляет repository.${operation}`,
      );
    }
    if (operation === "sync") {
      const canSync = plugin.canSync();
      if (typeof canSync !== "boolean") {
        throw new Error(`PLUGIN_CONTRACT_INVALID: ${plugin.id}.canSync должен вернуть boolean`);
      }
      if (!canSync) throw new Error(`PLUGIN_SYNC_UNSUPPORTED: ${plugin.id} не поддерживает sync`);
    }
    const context = operation === "connect"
      ? await this.#contexts.forRepositorySetup({ loadedPlugin, storeProject, repositoryId })
      : await this.#contexts.forRepository({ loadedPlugin, storeProject, repositoryId });
    if (operation === "connect") return plugin.connect(context);
    if (operation === "status") return plugin.status(context);
    return plugin.sync(context);
  }
}
