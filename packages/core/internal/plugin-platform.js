/** @fileoverview Composition root независимой Plugin Platform нового Core. */

import process from "node:process";

import { COMMAND_SCOPE } from "@openspec-orch/plugin-sdk";

import { isAgentExtensionAdapter } from "./agent-extension-adapter.js";
import { bundledAgents } from "./bundled-agent.js";
import { bundledExtensions } from "./bundled-extension.js";
import { bundledTemplates, isBundledTemplateProvider } from "./bundled-template.js";
import { BundledPluginProvider } from "./bundled-plugin.js";
import { CandidateCli } from "./cli.js";
import { currentRepositories } from "./current-repository.js";
import { ExtensionLifecycle } from "./extension-lifecycle.js";
import { InitializationService } from "./initialization.js";
import { InitSelectionService } from "./init-selection.js";
import { PluginApplicationService } from "./plugin-application.js";
import { pluginCatalog } from "./plugin-catalog.js";
import { pluginContexts } from "./plugin-context.js";
import { PluginLifecycleCommands } from "./plugin-cli.js";
import { PluginCommandMounter } from "./plugin-commands.js";
import { PluginHost, PluginRegistry } from "./plugin-host.js";
import { PluginLifecycleService } from "./plugin-lifecycle.js";
import { PluginManagerService, pluginManagers } from "./plugin-manager.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

/** Собирает Loader output, Host, lifecycle и CLI adapters без знания Plugin IDs. */
export class PluginPlatform {
  #bundledTemplates;
  #commands;
  #extensionLifecycle;
  #initialization;
  #initSelection;
  #pluginExtensions;
  #lifecycleCommands;

  constructor({
    agentAdapter,
    applicationService,
    bundledAgentProvider = bundledAgents,
    bundledExtensionProvider = bundledExtensions,
    bundledTemplateProvider = bundledTemplates,
    catalog,
    contextFactory = pluginContexts,
    currentRepositoryService = currentRepositories,
    loadedPlugins = [],
    pluginCommandOptions = {},
    rootCommands = new Map(),
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (!pluginCommandOptions || typeof pluginCommandOptions !== "object" || Array.isArray(pluginCommandOptions)) {
      throw new Error("PLUGIN_PLATFORM_INVALID: pluginCommandOptions должен быть object");
    }
    if (!isBundledTemplateProvider(bundledTemplateProvider)) {
      throw new Error(
        "PLUGIN_PLATFORM_INVALID: bundled Template provider должен предоставлять defaultId, catalog и resolve",
      );
    }
    this.#bundledTemplates = bundledTemplateProvider;
    for (const key of ["applicationService", "catalog", "lifecycleService"]) {
      if (Object.hasOwn(pluginCommandOptions, key)) {
        throw new Error(`PLUGIN_PLATFORM_INVALID: ${key} управляется PluginPlatform`);
      }
    }
    const resolvedAgentAdapter = agentAdapter ?? bundledAgentProvider.adapter;
    if (!isAgentExtensionAdapter(resolvedAgentAdapter)) {
      throw new Error("PLUGIN_PLATFORM_INVALID: bundled Agent provider не предоставляет adapter");
    }
    const registry = new PluginRegistry(loadedPlugins);
    const host = new PluginHost({
      agentAdapter: resolvedAgentAdapter,
      contextFactory,
      registry,
    });
    const lifecycle = new PluginLifecycleService({
      applicationService,
      host,
      start,
    });
    this.#pluginExtensions = lifecycle;
    this.#initialization = new InitializationService({ agentProvider: bundledAgentProvider });
    this.#initSelection = new InitSelectionService({
      agentCatalog: bundledAgentProvider.catalog,
      defaultTemplateId: bundledTemplateProvider.defaultId,
      extensionCatalog: bundledExtensionProvider.catalog,
      templateCatalog: bundledTemplateProvider.catalog,
    });
    this.#extensionLifecycle = new ExtensionLifecycle({
      agentAdapter: resolvedAgentAdapter,
      bundledProvider: bundledExtensionProvider,
      start,
      storeProjectService,
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
      resolveContext: async (pluginId, scope, requireBinding) => {
        const { storeProject, invocation } = await resolveInvocation();
        if (scope === COMMAND_SCOPE.current && !invocation) {
          throw new Error("PLUGIN_COMMAND_CONTEXT_UNAVAILABLE: текущий Repository не определён");
        }
        const loadedPlugin = registry.require(pluginId);
        if (
          !requireBinding &&
          scope === COMMAND_SCOPE.store &&
          !loadedPlugin.plugin.hasRepositoryContribution()
        ) {
          return contextFactory.forStoreSetup({ loadedPlugin, storeProject });
        }
        const createContext = requireBinding
          ? contextFactory.forRepository.bind(contextFactory)
          : contextFactory.forRepositorySetup.bind(contextFactory);
        return createContext({
          loadedPlugin,
          storeProject,
          repositoryId: scope === COMMAND_SCOPE.store ? storeProject.store.id : invocation.id,
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
    if (managerService !== undefined && !hasMethods(managerService, ["forStore"])) {
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
    const storeProjectService = options.storeProjectService ?? storeProjects;
    const resolved = loadedPlugins ?? await PluginPlatform.#loadInstalled(
      start,
      resolvedManagerService,
      storeProjectService,
    );
    return new PluginPlatform({
      ...options,
      applicationService,
      catalog,
      loadedPlugins: resolved,
      pluginCommandOptions,
      start,
      storeProjectService,
    });
  }

  createProgram(options) {
    return new CandidateCli({
      ...options,
      bundledTemplateProvider: this.#bundledTemplates,
      extensionLifecycle: this.#extensionLifecycle,
      initSelectionService: this.#initSelection,
      initializationService: this.#initialization,
      pluginCommandMounter: this.#commands,
      pluginExtensionConnector: this.#pluginExtensions,
      pluginLifecycleCommands: this.#lifecycleCommands,
    }).createProgram();
  }

  static async #loadInstalled(start, managerService, storeProjectService) {
    let storeProject;
    try {
      storeProject = await storeProjectService.resolve(start);
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
