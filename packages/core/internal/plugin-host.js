/** @fileoverview Fail-fast registry и repository lifecycle dispatch Plugins. */

import path from "node:path";
import { promises as fs } from "node:fs";

import { pluginContexts } from "./plugin-context.js";
import { LoadedPlugin } from "./plugin-loader.js";
import { isContainedPath } from "./path.js";
import { hasMethods } from "./value.js";

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

  find(pluginId) {
    return this.#plugins.get(pluginId) ?? null;
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
  #agentAdapter;
  #contexts;
  #registry;

  constructor({ agentAdapter, contextFactory = pluginContexts, registry } = {}) {
    if (!(registry instanceof PluginRegistry)) {
      throw new Error("PLUGIN_HOST_INVALID: требуется PluginRegistry");
    }
    if (!hasMethods(contextFactory, ["forRepository", "forRepositorySetup"])) {
      throw new Error("PLUGIN_HOST_INVALID: требуется PluginContextFactory");
    }
    if (agentAdapter !== undefined && !hasMethods(
      agentAdapter,
      ["invokeExtension", "validateExtension"],
    )) {
      throw new Error(
        "PLUGIN_HOST_INVALID: Agent Adapter должен предоставлять validateExtension/invokeExtension",
      );
    }
    this.#agentAdapter = agentAdapter;
    this.#contexts = contextFactory;
    this.#registry = registry;
    Object.freeze(this);
  }

  connect(options) {
    return this.#invoke("connect", options);
  }

  async connectExtensions({ pluginId, storeProject, repositoryId } = {}) {
    return this.#invokeBoundExtensions({ pluginId, storeProject, repositoryId }, "connect");
  }

  /** Проверяет все Extension contributions до Plugin/native lifecycle mutation. */
  async preflightExtensions({ pluginId, storeProject, repositoryId } = {}) {
    const loadedPlugin = this.#registry.require(pluginId);
    if (!this.#hasExtensionContribution(loadedPlugin.plugin)) return Object.freeze([]);
    const context = await this.#contexts.forRepositorySetup({
      loadedPlugin,
      storeProject,
      repositoryId,
    });
    return this.#prepareExtensions(loadedPlugin, context);
  }

  async disconnectExtensions({ pluginId, storeProject, repositoryId } = {}) {
    return this.#invokeBoundExtensions(
      { pluginId, storeProject, repositoryId },
      "disconnect",
      { optionalPlugin: true },
    );
  }

  assertLoaded(pluginId) {
    this.#registry.require(pluginId);
  }

  supportsRepository(pluginId, repository) {
    if (
      !repository ||
      typeof repository.id !== "string" ||
      typeof repository.role !== "string"
    ) {
      throw new Error("PLUGIN_REPOSITORY_INVALID: требуется Repository handle");
    }
    const { plugin } = this.#registry.require(pluginId);
    const contributes = plugin.hasRepositoryContribution();
    if (typeof contributes !== "boolean") {
      throw new Error(
        `PLUGIN_CONTRACT_INVALID: ${plugin.id}.hasRepositoryContribution должен вернуть boolean`,
      );
    }
    if (!contributes) {
      throw new Error(
        `PLUGIN_REPOSITORY_UNSUPPORTED: ${plugin.id} не предоставляет repository lifecycle`,
      );
    }
    const supported = plugin.supportsRole(repository.role);
    if (typeof supported !== "boolean") {
      throw new Error(`PLUGIN_CONTRACT_INVALID: ${plugin.id}.supportsRole должен вернуть boolean`);
    }
    return supported;
  }

  status(options) {
    return this.#invoke("status", options);
  }

  sync(options) {
    return this.#invoke("sync", options);
  }

  exec(options) {
    return this.#invoke("exec", options);
  }

  async #invoke(operation, { args, pluginId, storeProject, repositoryId } = {}) {
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
    let immutableArgs;
    if (operation === "exec") {
      const canExec = typeof plugin.canExec === "function" && plugin.canExec();
      if (typeof canExec !== "boolean") {
        throw new Error(`PLUGIN_CONTRACT_INVALID: ${plugin.id}.canExec должен вернуть boolean`);
      }
      if (!canExec || typeof plugin.exec !== "function") {
        throw new Error(`PLUGIN_EXEC_UNSUPPORTED: ${plugin.id} не поддерживает exec`);
      }
      if (
        !Array.isArray(args) ||
        args.length === 0 ||
        args.some((argument) => typeof argument !== "string")
      ) {
        throw new Error("PLUGIN_EXEC_INVALID: args должен быть непустым массивом строк");
      }
      immutableArgs = Object.freeze([...args]);
    }
    const context = operation === "connect"
      ? await this.#contexts.forRepositorySetup({ loadedPlugin, storeProject, repositoryId })
      : await this.#contexts.forRepository({ loadedPlugin, storeProject, repositoryId });
    if (operation === "connect") {
      const extensions = await this.#prepareExtensions(loadedPlugin, context);
      const output = await plugin.connect(context);
      await this.#invokePreparedExtensions(loadedPlugin, context, extensions, "connect");
      return output;
    }
    if (operation === "status") {
      const output = await plugin.status(context);
      await this.#invokeExtensions(loadedPlugin, context, "status");
      return output;
    }
    if (operation === "exec") return plugin.exec(context, immutableArgs);
    return plugin.sync(context);
  }

  async #invokeBoundExtensions(
    { pluginId, storeProject, repositoryId },
    operation,
    { optionalPlugin = false } = {},
  ) {
    const loadedPlugin = optionalPlugin
      ? this.#registry.find(pluginId)
      : this.#registry.require(pluginId);
    if (!loadedPlugin || !this.#hasExtensionContribution(loadedPlugin.plugin)) return;
    const context = await this.#contexts.forRepository({
      loadedPlugin,
      storeProject,
      repositoryId,
    });
    return this.#invokeExtensions(loadedPlugin, context, operation);
  }

  async #invokeExtensions(loadedPlugin, context, operation) {
    const extensions = await this.#prepareExtensions(loadedPlugin, context);
    return this.#invokePreparedExtensions(loadedPlugin, context, extensions, operation);
  }

  async #prepareExtensions(loadedPlugin, context) {
    const { plugin } = loadedPlugin;
    if (!this.#hasExtensionContribution(plugin)) return Object.freeze([]);
    if (!this.#agentAdapter) {
      throw new Error(`AGENT_EXTENSION_ADAPTER_UNAVAILABLE: ${context.agent?.id ?? "unknown"}`);
    }
    if (typeof plugin.extensions !== "function") {
      throw new Error(`PLUGIN_CONTRACT_INVALID: ${plugin.id}.extensions отсутствует`);
    }
    const extensions = await plugin.extensions(context);
    if (!Array.isArray(extensions)) {
      throw new Error(`PLUGIN_CONTRACT_INVALID: ${plugin.id}.extensions должен вернуть массив`);
    }
    const prepared = [];
    for (const extension of extensions) {
      const resolvedExtension = await this.#resolveExtension(loadedPlugin, context, extension);
      await this.#agentAdapter.validateExtension(resolvedExtension, { ownerId: plugin.id });
      prepared.push(resolvedExtension);
    }
    return Object.freeze(prepared);
  }

  async #invokePreparedExtensions(loadedPlugin, context, extensions, operation) {
    const request = Object.freeze({ operation, ownerId: loadedPlugin.id });
    for (const resolvedExtension of extensions) {
      await this.#agentAdapter.invokeExtension(context, resolvedExtension, request);
    }
  }

  async #resolveExtension(loadedPlugin, context, extension) {
    const packageRoot = await fs.realpath(loadedPlugin.root);
    const requestedRoot = path.resolve(packageRoot, extension.root);
    if (!isContainedPath(packageRoot, requestedRoot)) {
      throw new Error(`PLUGIN_EXTENSION_INVALID: ${loadedPlugin.id}/${extension.id} root выходит из package`);
    }
    const stat = await fs.lstat(requestedRoot).catch((cause) => {
      throw new Error(
        `PLUGIN_EXTENSION_INVALID: ${loadedPlugin.id}/${extension.id} root отсутствует`,
        { cause },
      );
    });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        `PLUGIN_EXTENSION_INVALID: ${loadedPlugin.id}/${extension.id} root должен быть directory без symlink`,
      );
    }
    const root = await fs.realpath(requestedRoot);
    if (!isContainedPath(packageRoot, root)) {
      throw new Error(
        `PLUGIN_EXTENSION_INVALID: ${loadedPlugin.id}/${extension.id} realpath выходит из package`,
      );
    }
    if (
      extension.target?.id !== context.repository?.id ||
      extension.target?.role !== context.repository?.role
    ) {
      throw new Error(
        `PLUGIN_EXTENSION_INVALID: ${loadedPlugin.id}/${extension.id} target не совпадает с context repository`,
      );
    }
    return Object.freeze({
      id: extension.id,
      root,
      target: extension.target,
    });
  }

  #hasExtensionContribution(plugin) {
    if (typeof plugin.hasExtensionContribution !== "function") return false;
    const hasContribution = plugin.hasExtensionContribution();
    if (typeof hasContribution !== "boolean") {
      throw new Error(
        `PLUGIN_CONTRACT_INVALID: ${plugin.id}.hasExtensionContribution должен вернуть boolean`,
      );
    }
    return hasContribution;
  }
}
