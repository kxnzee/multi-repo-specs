/** @fileoverview Composition root независимой Plugin Platform нового Core. */

import process from "node:process";

import { isAgentExtensionAdapter } from "./agent-extension-adapter.js";
import { bundledAgents } from "./bundled-agent.js";
import { bundledExtensions } from "./bundled-extension.js";
import { bundledTemplates, isBundledTemplateProvider } from "./bundled-template.js";
import { BundledPluginProvider } from "./bundled-plugin.js";
import { CandidateCli } from "./cli.js";
import { DoctorService } from "./doctor.js";
import { ExtensionLifecycle } from "./extension-lifecycle.js";
import { InitializationService } from "./initialization.js";
import { InitSelectionService } from "./init-selection.js";
import { PluginApplicationService } from "./plugin-application.js";
import { pluginCatalog } from "./plugin-catalog.js";
import { PluginLifecycleCommands } from "./plugin-cli.js";
import { PluginHost, PluginRegistry } from "./plugin-host.js";
import { PluginLifecycleService } from "./plugin-lifecycle.js";
import { PluginManagerService, pluginManagers } from "./plugin-manager.js";
import { ProjectSetupService } from "./project-setup.js";
import { RepositoryStatusService } from "./repository-status.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

const RECOVERABLE_PLUGIN_RESOLUTION = /^(?:BUNDLED_PLUGIN_INVALID|PLUGIN_CONTRACT_INVALID|PLUGIN_LOAD_INVALID|PLUGIN_MANAGER_INVALID|PLUGIN_RUNTIME_UNAVAILABLE):/u;

/** Keeps optional Plugin failures isolated without swallowing unrelated Core defects. */
function isRecoverablePluginResolution(error) {
  return error?.code === "PLUGIN_RUNTIME_UNAVAILABLE" ||
    RECOVERABLE_PLUGIN_RESOLUTION.test(error?.message ?? "");
}

/** Собирает Loader output, Host, lifecycle и CLI adapters без знания Plugin IDs. */
export class PluginPlatform {
  #bundledTemplates;
  #doctor;
  #extensionLifecycle;
  #initialization;
  #initSelection;
  #pluginExtensions;
  #lifecycleCommands;
  #setup;
  #setupCatalog;

  constructor({
    agentAdapter,
    applicationService,
    bundledAgentProvider = bundledAgents,
    bundledExtensionProvider = bundledExtensions,
    bundledTemplateProvider = bundledTemplates,
    catalog,
    contextFactory,
    loadedPlugins = [],
    pluginCommandOptions = {},
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
    this.#doctor = new DoctorService({
      extensionStatusService: this.#extensionLifecycle,
      pluginStatusService: lifecycle,
      repositoryStatusService: new RepositoryStatusService({ storeProjectService }),
      start,
      storeProjectService,
    });
    this.#setup = new ProjectSetupService({
      bundledTemplateProvider,
      extensionLifecycle: this.#extensionLifecycle,
      initializationService: this.#initialization,
      initSelectionService: this.#initSelection,
      pluginExtensionConnector: this.#pluginExtensions,
      start,
      storeProjectService,
    });
    this.#setupCatalog = Object.freeze({
      default_template_id: bundledTemplateProvider.defaultId,
      agents: Object.freeze(bundledAgentProvider.catalog.entries.map(({ id, name }) => (
        Object.freeze({ id, name })
      ))),
      templates: Object.freeze(bundledTemplateProvider.catalog.entries.map((entry) => (
        Object.freeze({
          id: entry.id,
          name: entry.name,
          required_extensions: entry.requiredExtensions,
        })
      ))),
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
      doctorService: this.#doctor,
      extensionLifecycle: this.#extensionLifecycle,
      initSelectionService: this.#initSelection,
      initializationService: this.#initialization,
      pluginExtensionConnector: this.#pluginExtensions,
      pluginLifecycleCommands: this.#lifecycleCommands,
      setupService: this.#setup,
    }).createProgram();
  }

  /** Runs the exact Doctor composition shared by CLI and other protocol adapters. */
  inspectDoctor(options) {
    return this.#doctor.inspect(options);
  }

  /** Describes the exact bundled choices accepted by strict MCP initialization. */
  inspectSetup() {
    return this.#setupCatalog;
  }

  /** Initializes only the Platform cwd through the shared strict setup application. */
  initializeProject(input) {
    return this.#setup.initializeExplicit(input);
  }

  /** Connects the current Project without relaxed mode or arbitrary workspace override. */
  connectProject() {
    return this.#setup.connect({ requireStrict: true });
  }

  static async #loadInstalled(start, managerService, storeProjectService) {
    let storeProject;
    try {
      storeProject = await storeProjectService.resolve(start);
    } catch {
      // Core commands, especially Doctor, must remain available to report Store errors.
      return Object.freeze([]);
    }
    const manager = managerService.forStore(storeProject.checkout);
    const loadedPlugins = [];
    for (const declaration of storeProject.project.pluginDeclarations) {
      try {
        loadedPlugins.push((await manager.resolve(declaration)).loadedPlugin);
      } catch (error) {
        if (!isRecoverablePluginResolution(error)) throw error;
        // A broken optional Plugin must not prevent Core and Doctor from starting.
        // Plugin lifecycle diagnostics report the declared binding as unavailable.
      }
    }
    return Object.freeze(loadedPlugins);
  }
}
