/** @fileoverview Shared Project setup application used by CLI and MCP adapters. */

import path from "node:path";
import process from "node:process";

import { bundledTemplates, isBundledTemplateProvider } from "./bundled-template.js";
import { connection } from "./connection.js";
import { CORE_EXECUTION_MODE, CORE_FILES } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { initialization } from "./initialization.js";
import { initSelections } from "./init-selection.js";
import { packageSupplies } from "./package-supply.js";
import { storeProjects } from "./store-project.js";
import { assertTemplateTargetSeparated } from "./template.js";
import { hasMethods } from "./value.js";

/** Distinguishes one explicit local Template path from a bundled Template ID. */
function isLocalTemplateRequest(request) {
  return path.isAbsolute(request) || request.startsWith(".") ||
    request.includes("/") || request.includes("\\");
}

/** Resolves one normalized Template request. */
function resolveTemplateRequest(provider, request) {
  return isLocalTemplateRequest(request)
    ? Object.freeze({ id: undefined, root: request })
    : provider.resolve(request);
}

/** Собирает известные Template roots, которые нельзя использовать как Store target. */
function knownTemplateRoots(provider, request) {
  if (typeof request === "string" && isLocalTemplateRequest(request)) return [request];
  const ids = new Set([
    provider.defaultId,
    ...provider.catalog.entries.map(({ id }) => id),
  ]);
  return [...ids].map((id) => provider.resolve(id).root);
}

/** Converts a ConnectionResult into a stable protocol-neutral value. */
function connectionResult(value) {
  return Object.freeze({
    store_id: value.storeId,
    store_root: value.storeRoot,
    workspace: value.workspace,
    execution_mode: value.executionMode,
    status: value.status,
    repositories: Object.freeze(value.repositories.map((repository) => Object.freeze({
      repository_id: repository.id,
      path: repository.path,
      branch: repository.branch,
      revision: repository.revision,
      cloned: repository.cloned,
      pointer_created: repository.pointerCreated,
      pointer_pending: repository.pointerPending,
      status: repository.status,
    }))),
  });
}

/** Converts an initialization result into a stable protocol-neutral value. */
function initializationResult(value) {
  return Object.freeze({
    target: value.target,
    store_id: value.storeId,
    already_initialized: value.alreadyInitialized,
    execution_mode: value.executionMode,
    created: value.created,
    updated: value.updated,
    agent: value.agent,
  });
}

/** Coordinates Core setup without owning CLI or MCP presentation. */
export class ProjectSetupService {
  #connection;
  #extensionLifecycles;
  #extensionPreflight;
  #initialization;
  #initSelection;
  #packages;
  #start;
  #storeProjects;
  #templates;

  constructor({
    bundledTemplateProvider = bundledTemplates,
    connectionService = connection,
    extensionLifecycle,
    initializationService = initialization,
    initSelectionService = initSelections,
    pluginExtensionConnector,
    packageSupplyService = packageSupplies,
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (!isBundledTemplateProvider(bundledTemplateProvider)) {
      throw new Error(
        "PROJECT_SETUP_INVALID: bundled Template provider должен предоставлять defaultId, catalog и resolve",
      );
    }
    if (!hasMethods(connectionService, ["connect"]) || !hasMethods(initializationService, ["initialize"])) {
      throw new Error("PROJECT_SETUP_INVALID: требуются initialization и connection services");
    }
    if (typeof initSelectionService?.resolve !== "function") {
      throw new Error("PROJECT_SETUP_INVALID: initSelectionService должен предоставлять resolve");
    }
    if (typeof packageSupplyService?.forStore !== "function") {
      throw new Error("PROJECT_SETUP_INVALID: packageSupplyService должен предоставлять forStore");
    }
    if (extensionLifecycle && !hasMethods(
      extensionLifecycle,
      ["connectSelected", "disconnectSelected", "preflight", "statusSelected"],
    )) {
      throw new Error("PROJECT_SETUP_INVALID: standalone Extension lifecycle несовместим");
    }
    if (pluginExtensionConnector && !hasMethods(
      pluginExtensionConnector,
      ["connectSelected", "disconnectSelected", "statusSelected"],
    )) {
      throw new Error("PROJECT_SETUP_INVALID: Plugin Extension lifecycle несовместим");
    }
    if (typeof start !== "string") throw new Error("PROJECT_SETUP_INVALID: start должен быть string");
    if (!hasMethods(storeProjectService, ["load", "resolve"])) {
      throw new Error("PROJECT_SETUP_INVALID: storeProjectService должен предоставлять load и resolve");
    }
    this.#connection = connectionService;
    this.#extensionPreflight = extensionLifecycle;
    this.#extensionLifecycles = Object.freeze(
      [extensionLifecycle, pluginExtensionConnector].filter(Boolean),
    );
    this.#initialization = initializationService;
    this.#initSelection = initSelectionService;
    this.#packages = packageSupplyService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    this.#templates = bundledTemplateProvider;
    Object.freeze(this);
  }

  /** Resolves explicit/interactive selection and delegates the mutation to InitializationService. */
  async initialize({ target = this.#start, options = {}, onSelectionResolved = () => {} } = {}) {
    if (typeof onSelectionResolved !== "function") {
      throw new Error("PROJECT_SETUP_INVALID: onSelectionResolved должен быть function");
    }
    assertTemplateTargetSeparated({
      targetRoot: target,
      templateRoots: knownTemplateRoots(this.#templates, options.template),
    });
    const selection = await this.#initSelection.resolve(options);
    if (!selection) return null;
    onSelectionResolved(selection);
    const templateRequest = selection.template ?? this.#templates.defaultId;
    const template = resolveTemplateRequest(this.#templates, templateRequest);
    const result = await this.#initialization.initialize({
      target,
      storeId: selection.storeId,
      agentId: selection.agentId,
      extensions: selection.extensions,
      replaceExtensions: selection.extensionsSpecified,
      templateId: template.id,
      templateRoot: template.root,
      repositories: selection.repositories,
      noStrict: selection.noStrict,
    });
    return Object.freeze({ result, selection });
  }

  /** Runs strict fixed-cwd initialization for a machine protocol adapter. */
  async initializeExplicit({
    agentId,
    repositories = [],
    storeId,
    templateId,
  } = {}) {
    const metadata = await lstatOrNull(path.join(this.#start, CORE_FILES.storeMetadata));
    if (metadata) {
      const storeProject = await this.#storeProjects.load(this.#start);
      if (!storeProject.project.strict) {
        throw new Error("MCP_SETUP_STRICT_REQUIRED: существующий Project настроен в relaxed mode");
      }
    }
    const operation = await this.initialize({
      target: this.#start,
      options: {
        agent: agentId,
        repo: repositories,
        store: storeId,
        strict: true,
        template: templateId,
      },
    });
    const result = initializationResult(operation.result);
    if (result.execution_mode !== CORE_EXECUTION_MODE.strict) {
      throw new Error("MCP_SETUP_STRICT_REQUIRED: существующий Project настроен в relaxed mode");
    }
    return result;
  }

  /** Runs the same complete connect sequence for every protocol adapter. */
  async connect({ workspace, noStrict = false, onProgress = () => {}, requireStrict = false } = {}) {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    if (requireStrict) {
      if (!storeProject.project.strict) {
        throw new Error("MCP_SETUP_STRICT_REQUIRED: connect_project недоступен для relaxed Project");
      }
    }
    onProgress("Восстановление Store packages из npm lock...");
    await this.#packages.forStore(storeProject.checkout).ensure();
    onProgress("Проверка native CLI выбранного Agent...");
    await this.#extensionPreflight?.preflight();
    const result = await this.#connection.connect({
      start: storeProject.root,
      workspace,
      noStrict,
      onProgress,
    });
    onProgress("Подключение выбранных Extensions...");
    for (const lifecycle of this.#extensionLifecycles) {
      await lifecycle.connectSelected({ start: storeProject.root });
    }
    onProgress("Проверка состояния Extensions и Plugins...");
    for (const lifecycle of this.#extensionLifecycles) {
      await lifecycle.statusSelected({ start: storeProject.root });
    }
    return connectionResult(result);
  }

  /** Disconnects only Agent Extensions; exposed to CLI, not to MCP. */
  async disconnect() {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    for (const lifecycle of [...this.#extensionLifecycles].reverse()) {
      await lifecycle.disconnectSelected({ start: storeProject.root });
    }
  }
}
