/** @fileoverview Immutable repository-scoped PluginContext поверх Core facades. */

import { LoadedPlugin } from "./plugin-loader.js";
import { files } from "./files.js";
import { git } from "./git.js";
import { openspec } from "./openspec.js";
import { pluginStorage } from "./plugin-storage.js";
import { processes } from "./process.js";
import { coreState } from "./core-state.js";
import { StoreProject } from "./store-project.js";
import { deepFreeze } from "./value.js";
import { workspace } from "./workspace.js";

/** Создаёт минимальный immutable Repository handle без transport и filesystem данных. */
function repositoryHandle(repository) {
  return Object.freeze({ id: repository.id, role: repository.role });
}

/** Проверяет сообщение Plugin logger. */
function assertMessage(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("PLUGIN_LOG_INVALID: message должна быть непустой строкой");
  }
}

/** Read-only registry с проверкой Plugin bindings. */
class PluginRepositoryRegistry {
  #gitFactory;
  #handles;
  #plugin;
  #project;

  constructor(project, plugin, gitFactory) {
    if (typeof gitFactory !== "function") {
      throw new Error("PLUGIN_REPOSITORIES_INVALID: требуется Git facade factory");
    }
    this.#project = project;
    this.#plugin = plugin;
    this.#gitFactory = gitFactory;
    this.#handles = new Map(project.repositories.map((repository) => (
      [repository.id, repositoryHandle(repository)]
    )));
    Object.freeze(this);
  }

  list() {
    return Object.freeze([...this.#handles.values()]);
  }

  require(repositoryId) {
    const repository = this.#project.requireRepository(repositoryId);
    return this.#handles.get(repository.id);
  }

  requireConnected(repositoryIds) {
    if (!Array.isArray(repositoryIds)) {
      throw new Error("PLUGIN_REPOSITORIES_INVALID: repositoryIds должен быть массивом");
    }
    if (repositoryIds.length === 0) return Object.freeze([]);
    const selected = this.#project.selectRepositories(repositoryIds);
    for (const repository of selected) {
      if (!repository.hasPlugin(this.#plugin.id)) {
        throw new Error(
          `PLUGIN_NOT_CONNECTED: ${this.#plugin.id} не подключён к ${repository.id}`,
        );
      }
      this.#plugin.assertSupports(repository);
    }
    return Object.freeze(selected.map((repository) => this.#handles.get(repository.id)));
  }

  async git(repositoryId) {
    this.requireConnected([repositoryId]);
    try {
      return await this.#gitFactory(this.#project.requireRepository(repositoryId));
    } catch (error) {
      if (error.code === "REPOSITORY_CHECKOUT_UNAVAILABLE") return null;
      throw error;
    }
  }
}

/** Git API без раскрытия checkout root и mutation-команд. */
class PluginGitFacade {
  #git;

  constructor(repositoryGit) {
    this.#git = repositoryGit;
    Object.freeze(this);
  }

  currentBranch() { return this.#git.currentBranch(); }
  statusPaths(pathspec) { return this.#git.statusPaths(pathspec); }
  isClean(pathspec) { return this.#git.isClean(pathspec); }
  revision() { return this.#git.revision(); }
  hasCommit(revision) { return this.#git.hasCommit(revision); }
  assertNoOperation() { return this.#git.assertNoOperation(); }
}

/** OpenSpec API, пока ограниченный реально проверяемой версией CLI. */
class PluginOpenSpecFacade {
  #openspec;

  constructor(repositoryOpenSpec) {
    this.#openspec = repositoryOpenSpec;
    Object.freeze(this);
  }

  version() { return this.#openspec.version(); }
}

/** Files API без root getter. */
class PluginFilesFacade {
  #files;

  constructor(repositoryFiles) {
    this.#files = repositoryFiles;
    Object.freeze(this);
  }

  read(relativePath, options) { return this.#files.read(relativePath, options); }
  write(relativePath, contents, options) {
    return this.#files.write(relativePath, contents, options);
  }
}

/** Process API с Core cwd и timeout, которые Plugin не может переопределить. */
class PluginProcessFacade {
  #process;

  constructor(scopedProcess) {
    this.#process = scopedProcess;
    Object.freeze(this);
  }

  run(executable, args, { environment, onStderr, sensitiveValues } = {}) {
    return this.#process.run(executable, args, { environment, onStderr, sensitiveValues });
  }
}

/** Logger с автоматической Plugin/Repository identity. */
class PluginLogger {
  #prefix;
  #sink;

  constructor(pluginId, repositoryId, sink) {
    if (!sink || ["info", "warn", "error"].some((method) => typeof sink[method] !== "function")) {
      throw new Error("PLUGIN_LOG_INVALID: sink должен предоставлять info, warn и error");
    }
    this.#prefix = `[plugin:${pluginId}][repository:${repositoryId}]`;
    this.#sink = sink;
    Object.freeze(this);
  }

  info(message) { this.#write("info", message); }
  warn(message) { this.#write("warn", message); }
  error(message) { this.#write("error", message); }

  #write(level, message) {
    assertMessage(message);
    this.#sink[level](`${this.#prefix} ${message}`);
  }
}

/** Immutable PluginContext одного repository lifecycle invocation. */
export class PluginContext {
  #value;

  constructor(value) {
    const required = [
      "project",
      "repositories",
      "repository",
      "git",
      "openspec",
      "files",
      "process",
      "storage",
      "agent",
      "logger",
    ];
    if (!value || required.some((field) => value[field] === undefined)) {
      throw new Error("PLUGIN_CONTEXT_INVALID: отсутствует обязательный Core facade");
    }
    if (required.some((field) => (
      !value[field] || typeof value[field] !== "object" || !Object.isFrozen(value[field])
    ))) {
      throw new Error("PLUGIN_CONTEXT_INVALID: все Core facades должны быть immutable objects");
    }
    this.#value = Object.freeze({ ...value });
    Object.freeze(this);
  }

  get project() { return this.#value.project; }
  get repositories() { return this.#value.repositories; }
  get repository() { return this.#value.repository; }
  get git() { return this.#value.git; }
  get openspec() { return this.#value.openspec; }
  get files() { return this.#value.files; }
  get process() { return this.#value.process; }
  get storage() { return this.#value.storage; }
  get agent() { return this.#value.agent; }
  get logger() { return this.#value.logger; }
}

/** Создаёт новый контекст после проверки регистрации, binding и checkout. */
export class PluginContextFactory {
  #files;
  #git;
  #logSink;
  #openspec;
  #processes;
  #state;
  #storage;
  #workspace;

  constructor({
    fileService = files,
    gitService = git,
    logSink = console,
    openSpecService = openspec,
    processService = processes,
    stateService = coreState,
    storageService = pluginStorage,
    workspaceService = workspace,
  } = {}) {
    this.#files = fileService;
    this.#git = gitService;
    this.#logSink = logSink;
    this.#openspec = openSpecService;
    this.#processes = processService;
    this.#state = stateService;
    this.#storage = storageService;
    this.#workspace = workspaceService;
    Object.freeze(this);
  }

  async forRepository({ loadedPlugin, storeProject, repositoryId } = {}) {
    return this.#create({ loadedPlugin, storeProject, repositoryId, requireBinding: true });
  }

  async forRepositorySetup({ loadedPlugin, storeProject, repositoryId } = {}) {
    return this.#create({ loadedPlugin, storeProject, repositoryId, requireBinding: false });
  }

  async #create({ loadedPlugin, storeProject, repositoryId, requireBinding }) {
    if (!(loadedPlugin instanceof LoadedPlugin) || !(storeProject instanceof StoreProject)) {
      throw new Error("PLUGIN_CONTEXT_INVALID: требуются LoadedPlugin и StoreProject");
    }
    if (typeof repositoryId !== "string" || repositoryId.length === 0) {
      throw new Error("PLUGIN_CONTEXT_INVALID: repositoryId обязателен");
    }
    const { plugin } = loadedPlugin;
    const { project } = storeProject;
    project.requirePlugin(plugin.id);
    if (project.agents.length !== 1) {
      throw new Error("PLUGIN_CONTEXT_INVALID: Project должен содержать ровно одного Agent");
    }
    const repositories = new PluginRepositoryRegistry(project, plugin, async (selected) => {
      const selectedCheckout = await this.#resolveCheckout(storeProject, selected);
      return new PluginGitFacade(this.#git.forRepository(selectedCheckout));
    });
    const repositoryModel = project.requireRepository(repositoryId);
    let repository;
    if (requireBinding) {
      [repository] = repositories.requireConnected([repositoryId]);
    } else {
      plugin.assertSupports(repositoryModel);
      repository = repositories.require(repositoryId);
    }
    const checkout = await this.#resolveCheckout(storeProject, repositoryModel);
    const agent = Object.freeze({ id: project.agents[0] });
    const projectSnapshot = deepFreeze({
      id: storeProject.store.id,
      strict: project.strict,
      store: repositories.require(project.storeRepository.id),
      repositories: repositories.list(),
      agent,
    });
    return new PluginContext({
      project: projectSnapshot,
      repositories,
      repository,
      git: new PluginGitFacade(this.#git.forRepository(checkout)),
      openspec: new PluginOpenSpecFacade(this.#openspec.forRepository(checkout)),
      files: new PluginFilesFacade(this.#files.forRepository(checkout)),
      process: new PluginProcessFacade(this.#processes.forRepository(checkout)),
      storage: this.#storage.forPlugin(storeProject.checkout, plugin.id),
      agent,
      logger: new PluginLogger(plugin.id, repository.id, this.#logSink),
    });
  }

  async #resolveCheckout(storeProject, repository) {
    if (repository.isStore()) return storeProject.checkout;
    const storedWorkspace = (await this.#state.forStore(storeProject.checkout).read()).workspace;
    const workspaceModel = await this.#workspace.resolve({
      storeRoot: storeProject.root,
      storeId: storeProject.store.id,
      storedWorkspace,
    });
    return this.#workspace.resolveCheckout(workspaceModel, repository);
  }
}

/** Общая factory repository-scoped PluginContext нового Core. */
export const pluginContexts = Object.freeze(new PluginContextFactory());
