/** @fileoverview Composition root независимой Plugin Platform нового Core. */

import process from "node:process";

import { BundledPluginProvider } from "./bundled-plugin.js";
import { CandidateCli } from "./cli.js";
import { PluginApplicationService } from "./plugin-application.js";
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
  #host;
  #lifecycle;
  #lifecycleCommands;
  #registry;

  constructor({
    contextFactory = pluginContexts,
    loadedPlugins = [],
    pluginCliOptions = {},
    rootCommands = new Map(),
  } = {}) {
    if (!pluginCliOptions || typeof pluginCliOptions !== "object" || Array.isArray(pluginCliOptions)) {
      throw new Error("PLUGIN_PLATFORM_INVALID: pluginCliOptions должен быть object");
    }
    this.#registry = new PluginRegistry(loadedPlugins);
    this.#host = new PluginHost({ contextFactory, registry: this.#registry });
    const applicationService = pluginCliOptions.applicationService;
    this.#lifecycle = new PluginLifecycleService({
      ...(applicationService === undefined ? {} : { applicationService }),
      host: this.#host,
    });
    this.#commands = new PluginCommandMounter({
      registry: this.#registry,
      rootCommands,
    });
    this.#lifecycleCommands = new PluginLifecycleCommands({
      ...pluginCliOptions,
      lifecycleService: this.#lifecycle,
    });
    Object.freeze(this);
  }

  get registry() { return this.#registry; }
  get host() { return this.#host; }
  get lifecycle() { return this.#lifecycle; }

  createProgram(options) {
    return new CandidateCli({
      ...options,
      pluginCommandMounter: this.#commands,
      pluginLifecycleCommands: this.#lifecycleCommands,
    }).createProgram();
  }
}

/** Асинхронно восстанавливает установленные Plugins и собирает Plugin Platform. */
export class PluginPlatformService {
  #managers;
  #storeProjects;

  constructor({ managerService = pluginManagers, storeProjectService = storeProjects } = {}) {
    if (typeof managerService?.forStore !== "function") {
      throw new Error("PLUGIN_PLATFORM_INVALID: managerService должен предоставлять forStore");
    }
    if (typeof storeProjectService?.find !== "function") {
      throw new Error("PLUGIN_PLATFORM_INVALID: storeProjectService должен предоставлять find");
    }
    this.#managers = managerService;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async create({ bundledProvider, loadedPlugins, pluginCliOptions = {}, start = process.cwd(), ...options } = {}) {
    let managerService = this.#managers;
    let resolvedPluginCliOptions = pluginCliOptions;
    if (bundledProvider !== undefined) {
      if (!(bundledProvider instanceof BundledPluginProvider)) {
        throw new Error("PLUGIN_PLATFORM_INVALID: bundledProvider должен быть BundledPluginProvider");
      }
      managerService = new PluginManagerService({ bundledProvider });
      resolvedPluginCliOptions = {
        applicationService: new PluginApplicationService({
          managerService,
        }),
        catalog: bundledProvider.catalog,
        ...pluginCliOptions,
      };
    }
    const resolved = loadedPlugins ?? await this.#loadInstalled(start, managerService);
    return new PluginPlatform({
      ...options,
      loadedPlugins: resolved,
      pluginCliOptions: resolvedPluginCliOptions,
    });
  }

  async #loadInstalled(start, managerService) {
    let storeProject;
    try {
      storeProject = await this.#storeProjects.find(start);
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

/** Общий async composition facade Plugin Platform. */
export const pluginPlatforms = Object.freeze(new PluginPlatformService());
