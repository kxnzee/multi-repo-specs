/** @fileoverview Composition root независимой Plugin Platform нового Core. */

import process from "node:process";

import { BundledPluginProvider } from "./bundled-plugin.js";
import { CandidateCli } from "./cli.js";
import { currentRepositories } from "./current-repository.js";
import { PluginApplicationService } from "./plugin-application.js";
import { pluginCatalog } from "./plugin-catalog.js";
import { pluginContexts } from "./plugin-context.js";
import { PluginLifecycleCommands } from "./plugin-cli.js";
import { PluginCommandMounter } from "./plugin-commands.js";
import { PluginHost, PluginRegistry } from "./plugin-host.js";
import { PluginLifecycleService } from "./plugin-lifecycle.js";
import { PluginManagerService, pluginManagers } from "./plugin-manager.js";
import { storeProjects } from "./store-project.js";

/** Собирает Loader output, Host, lifecycle и CLI adapters без знания Plugin IDs. */
export class PluginPlatform {
  #commands;
  #lifecycleCommands;

  constructor({
    applicationService,
    catalog,
    contextFactory = pluginContexts,
    currentRepositoryService = currentRepositories,
    loadedPlugins = [],
    pluginCommandOptions = {},
    rootCommands = new Map(),
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (
      !pluginCommandOptions ||
      typeof pluginCommandOptions !== "object" ||
      Array.isArray(pluginCommandOptions)
    ) {
      throw new Error("PLUGIN_PLATFORM_INVALID: pluginCommandOptions должен быть object");
    }
    for (const key of ["applicationService", "catalog", "lifecycleService"]) {
      if (Object.hasOwn(pluginCommandOptions, key)) {
        throw new Error(`PLUGIN_PLATFORM_INVALID: ${key} управляется PluginPlatform`);
      }
    }
    const registry = new PluginRegistry(loadedPlugins);
    const host = new PluginHost({ contextFactory, registry });
    const lifecycle = new PluginLifecycleService({
      applicationService,
      host,
    });
    const loadedIds = new Set(registry.list().map(({ id }) => id));
    const activeRootCommands = new Map(
      [...rootCommands].filter(([pluginId]) => loadedIds.has(pluginId)),
    );
    let invocationPromise;
    const resolveInvocation = () => {
      invocationPromise ??= storeProjectService.resolve(start).then(async (storeProject) => ({
        storeProject,
        invocation: await currentRepositoryService.resolve({ start, storeProject }),
      }));
      return invocationPromise;
    };
    this.#commands = new PluginCommandMounter({
      registry,
      resolveContext: async (pluginId, scope) => {
        const { storeProject, invocation } = await resolveInvocation();
        if (scope === "current" && !invocation) {
          throw new Error("PLUGIN_COMMAND_CONTEXT_UNAVAILABLE: текущий Repository не определён");
        }
        return contextFactory.forRepository({
          loadedPlugin: registry.require(pluginId),
          storeProject,
          repositoryId: scope === "store" ? storeProject.store.id : invocation.id,
          invocation,
        });
      },
      rootCommands: activeRootCommands,
    });
    this.#lifecycleCommands = new PluginLifecycleCommands({
      ...pluginCommandOptions,
      applicationService,
      catalog,
      lifecycleService: lifecycle,
    });
    Object.freeze(this);
  }

  /** Восстанавливает установленные Plugins и собирает готовую Platform. */
  static async create({
    bundledProvider,
    loadedPlugins,
    managerService,
    pluginCommandOptions = {},
    start = process.cwd(),
    ...options
  } = {}) {
    if (managerService !== undefined && typeof managerService?.forStore !== "function") {
      throw new Error("PLUGIN_PLATFORM_INVALID: managerService должен предоставлять forStore");
    }
    if (bundledProvider !== undefined && managerService !== undefined) {
      throw new Error("PLUGIN_PLATFORM_INVALID: выберите bundledProvider или managerService");
    }
    let resolvedManagerService = managerService ?? pluginManagers;
    let catalog = pluginCatalog;
    if (bundledProvider !== undefined) {
      if (!(bundledProvider instanceof BundledPluginProvider)) {
        throw new Error("PLUGIN_PLATFORM_INVALID: bundledProvider должен быть BundledPluginProvider");
      }
      resolvedManagerService = new PluginManagerService({ bundledProvider });
      catalog = bundledProvider.catalog;
    }
    const applicationService = new PluginApplicationService({
      managerService: resolvedManagerService,
    });
    const resolved = loadedPlugins ?? await PluginPlatform.#loadInstalled(
      start,
      resolvedManagerService,
    );
    return new PluginPlatform({
      ...options,
      applicationService,
      catalog,
      loadedPlugins: resolved,
      pluginCommandOptions,
      start,
    });
  }

  createProgram(options) {
    return new CandidateCli({
      ...options,
      pluginCommandMounter: this.#commands,
      pluginLifecycleCommands: this.#lifecycleCommands,
    }).createProgram();
  }

  static async #loadInstalled(start, managerService) {
    let storeProject;
    try {
      storeProject = await storeProjects.resolve(start);
    } catch (error) {
      if (error.code === "STORE_ROOT_NOT_FOUND") return Object.freeze([]);
      throw error;
    }
    const manager = managerService.forStore(storeProject.checkout);
    const loadedPlugins = [];
    for (const declaration of storeProject.project.pluginDeclarations) {
      try {
        loadedPlugins.push((await manager.resolve(declaration)).loadedPlugin);
      } catch (error) {
        if (error.code !== "PLUGIN_RUNTIME_UNAVAILABLE") throw error;
      }
    }
    return Object.freeze(loadedPlugins);
  }
}
