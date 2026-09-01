/** @fileoverview Shared Project setup application used by CLI and MCP adapters. */

import path from "node:path";
import process from "node:process";

import { isBundledTemplateProvider } from "./bundled-template.js";
import { connection } from "./connection.js";
import { CORE_EXECUTION_MODE, CORE_FILES } from "./constants.js";
import { lstatOrNull } from "./fs.js";
import { initialization } from "./initialization.js";
import { initSelections } from "./init-selection.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

const DEFAULT_TEMPLATE_ID = "default";

/** Builds the compatibility provider used by direct CandidateCli tests. */
function legacyTemplateProvider(templateRoot) {
  return Object.freeze({
    defaultId: DEFAULT_TEMPLATE_ID,
    catalog: Object.freeze({ entries: Object.freeze([]) }),
    resolve(templateId) {
      if (templateId === DEFAULT_TEMPLATE_ID && typeof templateRoot === "string") {
        return Object.freeze({ id: DEFAULT_TEMPLATE_ID, root: templateRoot });
      }
      throw new Error(`TEMPLATE_NOT_DISCOVERED: template-id '${templateId ?? ""}' не найден`);
    },
  });
}

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
  #start;
  #storeProjects;
  #templates;

  constructor({
    bundledTemplateProvider,
    connectionService = connection,
    extensionLifecycle,
    initializationService = initialization,
    initSelectionService = initSelections,
    pluginExtensionConnector,
    start = process.cwd(),
    storeProjectService = storeProjects,
    templateRoot,
  } = {}) {
    const templates = bundledTemplateProvider ?? legacyTemplateProvider(templateRoot);
    if (!isBundledTemplateProvider(templates)) {
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
    this.#start = start;
    this.#storeProjects = storeProjectService;
    this.#templates = templates;
    Object.freeze(this);
  }

  /** Resolves explicit/interactive selection and delegates the mutation to InitializationService. */
  async initialize({ target = this.#start, options = {} } = {}) {
    const selection = await this.#initSelection.resolve(options);
    if (!selection) return null;
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
    let start = this.#start;
    if (requireStrict) {
      const storeProject = await this.#storeProjects.resolve(this.#start);
      if (!storeProject.project.strict) {
        throw new Error("MCP_SETUP_STRICT_REQUIRED: connect_project недоступен для relaxed Project");
      }
      start = storeProject.root;
    }
    onProgress("Проверка native CLI выбранного Agent...");
    await this.#extensionPreflight?.preflight();
    const result = await this.#connection.connect({
      start,
      workspace,
      noStrict,
      onProgress,
    });
    onProgress("Подключение выбранных Extensions...");
    for (const lifecycle of this.#extensionLifecycles) await lifecycle.connectSelected();
    onProgress("Проверка состояния Extensions и Plugins...");
    for (const lifecycle of this.#extensionLifecycles) await lifecycle.statusSelected();
    return connectionResult(result);
  }

  /** Disconnects only Agent Extensions; exposed to CLI, not to MCP. */
  async disconnect() {
    for (const lifecycle of [...this.#extensionLifecycles].reverse()) {
      await lifecycle.disconnectSelected();
    }
  }
}
