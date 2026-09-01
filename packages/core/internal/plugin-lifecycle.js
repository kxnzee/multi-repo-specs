/** @fileoverview Application service repository lifecycle одного Plugin. */

import process from "node:process";

import { pluginApplications } from "./plugin-application.js";
import { PluginHost } from "./plugin-host.js";
import { repositoryRunner } from "./repository-operations.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

const REPOSITORY_OPERATIONS = new Set(["connect", "disconnect", "exec", "sync"]);
const SELECTED_OPERATION_METHODS = Object.freeze({
  connect: "connect",
  disconnect: "disconnectExtensions",
  status: "status",
});

/** Выбирает связанные repositories явно или все в стабильном проектном порядке. */
function selectConnections(project, pluginId, repositoryIds) {
  const connections = project.pluginConnections({ pluginId });
  if (repositoryIds === undefined) return connections;
  if (!Array.isArray(repositoryIds)) {
    throw new Error("PLUGIN_REPOSITORY_SELECTION_INVALID: repositoryIds должен быть массивом");
  }
  const selectedIds = [...new Set(repositoryIds)];
  return Object.freeze(selectedIds.map((repositoryId) => {
    const repository = project.requireRepository(repositoryId);
    if (!project.isPluginConnected(pluginId, repositoryId)) {
      throw new Error(`PLUGIN_NOT_CONNECTED: ${pluginId} не подключён к ${repositoryId}`);
    }
    return Object.freeze({ pluginId, repository });
  }));
}

/** Возвращает transport-neutral данные Repository для CLI selection. */
function repositoryCandidates(repositories) {
  return Object.freeze(repositories.map(({ id, role }) => Object.freeze({ id, role })));
}

/** Immutable результат `plugin connect` для одного Repository. */
export class PluginConnectionResult {
  #connected;
  #output;
  #pluginId;
  #repositoryId;

  constructor({ connected, output, pluginId, repositoryId }) {
    if (
      typeof connected !== "boolean" ||
      typeof pluginId !== "string" ||
      typeof repositoryId !== "string"
    ) {
      throw new Error("PLUGIN_CONNECTION_RESULT_INVALID: некорректный lifecycle result");
    }
    this.#connected = connected;
    this.#output = output;
    this.#pluginId = pluginId;
    this.#repositoryId = repositoryId;
    Object.freeze(this);
  }

  get connected() { return this.#connected; }
  get output() { return this.#output; }
  get pluginId() { return this.#pluginId; }
  get repositoryId() { return this.#repositoryId; }
}

/** Immutable результат `plugin disconnect` для одного Repository. */
export class PluginDisconnectionResult {
  #disconnected;
  #pluginId;
  #repositoryId;

  constructor({ disconnected, pluginId, repositoryId }) {
    if (
      typeof disconnected !== "boolean" ||
      typeof pluginId !== "string" ||
      typeof repositoryId !== "string"
    ) {
      throw new Error("PLUGIN_DISCONNECTION_RESULT_INVALID: некорректный lifecycle result");
    }
    this.#disconnected = disconnected;
    this.#pluginId = pluginId;
    this.#repositoryId = repositoryId;
    Object.freeze(this);
  }

  get disconnected() { return this.#disconnected; }
  get pluginId() { return this.#pluginId; }
  get repositoryId() { return this.#repositoryId; }
}

/** Immutable нормализованный status одного Plugin binding. */
export class PluginStatusResult {
  #output;
  #pluginId;
  #repositoryId;
  #state;

  constructor({ output = "", pluginId, repositoryId, state }) {
    if (
      typeof output !== "string" ||
      typeof pluginId !== "string" ||
      typeof repositoryId !== "string" ||
      typeof state !== "string" ||
      state.trim().length === 0
    ) {
      throw new Error("PLUGIN_STATUS_RESULT_INVALID: некорректный status result");
    }
    this.#output = output;
    this.#pluginId = pluginId;
    this.#repositoryId = repositoryId;
    this.#state = state;
    Object.freeze(this);
  }

  get output() { return this.#output; }
  get pluginId() { return this.#pluginId; }
  get repositoryId() { return this.#repositoryId; }
  get state() { return this.#state; }

  toJSON() {
    return Object.freeze({
      pluginId: this.#pluginId,
      repositoryId: this.#repositoryId,
      state: this.#state,
      output: this.#output,
    });
  }
}

/** Преобразует публичный Plugin status contract в Core domain result. */
function statusResult(pluginId, repositoryId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PLUGIN_STATUS_INVALID: ${pluginId} должен вернуть status object`);
  }
  return new PluginStatusResult({
    pluginId,
    repositoryId,
    state: value.state,
    output: value.details ?? "",
  });
}

/** Возвращает стабильное сообщение даже для non-Error throw из Plugin. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Координирует Store lookup, Plugin Host и запись binding. */
export class PluginLifecycleService {
  #applications;
  #host;
  #runner;
  #start;
  #storeProjects;

  constructor({
    applicationService = pluginApplications,
    host,
    repositoryRunnerService = repositoryRunner,
    start,
    storeProjectService = storeProjects,
  } = {}) {
    if (!(host instanceof PluginHost)) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginHost");
    }
    if (!hasMethods(applicationService, ["connectMany", "disconnect", "disconnectMany"])) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginApplicationService");
    }
    if (!hasMethods(repositoryRunnerService, ["run"])) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется RepositoryRunner");
    }
    if (!hasMethods(storeProjectService, ["find"])) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется StoreProjectService");
    }
    if (start !== undefined && typeof start !== "string") {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: start должен быть строкой");
    }
    this.#applications = applicationService;
    this.#host = host;
    this.#runner = repositoryRunnerService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async connect({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const [result] = await this.connectMany({
      start,
      pluginId,
      repositoryIds: [repositoryId],
    });
    return result;
  }

  async connectMany({ start = process.cwd(), pluginId, repositoryIds } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    this.#host.assertLoaded(pluginId);
    const changes = await this.#applications.connectMany(
      storeProject,
      pluginId,
      repositoryIds,
      (current, repositoryId) => this.#host.connect({
        pluginId,
        repositoryId,
        storeProject: current,
      }),
    );
    const selectedIds = [...new Set(repositoryIds)];
    for (const [index, change] of changes.entries()) {
      if (!change.changed) {
        await this.#host.connectExtensions({
          pluginId,
          repositoryId: selectedIds[index],
          storeProject,
        });
      }
    }
    return Object.freeze(changes.map((change, index) => new PluginConnectionResult({
      connected: change.changed,
      output: change.output,
      pluginId,
      repositoryId: selectedIds[index],
    })));
  }

  /** Восстанавливает runtime и Agent Extensions всех portable Plugin bindings Store. */
  async connectSelected({ start = this.#start ?? process.cwd() } = {}) {
    return this.#invokeSelected("connect", start);
  }

  /** Проверяет runtime и Agent Extensions всех portable Plugin bindings Store. */
  async statusSelected({ start = this.#start ?? process.cwd() } = {}) {
    return this.#invokeSelected("status", start);
  }

  /** Локально отключает Agent Extensions всех portable Plugin bindings без изменения config. */
  async disconnectSelected({ start = this.#start ?? process.cwd() } = {}) {
    return this.#invokeSelected("disconnect", start);
  }

  async #invokeSelected(operation, start) {
    const storeProject = await this.#storeProjects.find(start);
    const selected = storeProject.project.pluginConnections();
    const connections = operation === "disconnect" ? [...selected].reverse() : selected;
    const results = [];
    for (const { pluginId, repository } of connections) {
      try {
        this.#host.assertLoaded(pluginId);
        const value = await this.#host[SELECTED_OPERATION_METHODS[operation]]({
          pluginId,
          repositoryId: repository.id,
          storeProject,
        });
        if (operation === "status") results.push(statusResult(pluginId, repository.id, value));
      } catch (error) {
        if (!error.message?.startsWith("PLUGIN_NOT_LOADED:")) throw error;
        throw new Error(
          `PLUGIN_RUNTIME_UNAVAILABLE: ${pluginId} объявлен в Store, но package недоступен; ` +
            `восстановите его через plugin init --plugin ${pluginId} [--from <source>] и ` +
            "повторите connect",
          { cause: error },
        );
      }
    }
    if (operation === "status") return Object.freeze(results);
    return Object.freeze(connections.map(({ pluginId, repository }) => Object.freeze({
      pluginId,
      repositoryId: repository.id,
    })));
  }

  async repositoryCandidates({ start = process.cwd(), pluginId, operation } = {}) {
    if (!REPOSITORY_OPERATIONS.has(operation)) {
      throw new Error(`PLUGIN_REPOSITORY_SELECTION_INVALID: неизвестная operation '${operation}'`);
    }
    const storeProject = await this.#storeProjects.find(start);
    storeProject.project.requirePlugin(pluginId);
    if (operation === "connect") {
      this.#host.assertLoaded(pluginId);
      return repositoryCandidates(storeProject.project.repositories.filter((repository) => (
        this.#host.supportsRepository(pluginId, repository)
      )));
    }
    if (operation !== "disconnect") this.#host.assertLoaded(pluginId);
    return repositoryCandidates(storeProject.project
      .pluginConnections({ pluginId })
      .map(({ repository }) => repository));
  }

  async disconnect({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const [result] = await this.disconnectMany({
      start,
      pluginId,
      repositoryIds: [repositoryId],
    });
    return result;
  }

  async disconnectMany({ start = process.cwd(), pluginId, repositoryIds } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const selectedIds = [...new Set(repositoryIds ?? storeProject.project
      .pluginConnections({ pluginId })
      .map(({ repository }) => repository.id))];
    if (selectedIds.length === 0) return Object.freeze([]);
    const connectedIds = selectedIds.filter((repositoryId) => (
      storeProject.project.isPluginConnected(pluginId, repositoryId)
    ));
    const disconnectedIds = new Set(connectedIds);
    const remainingIds = storeProject.project.pluginConnections({ pluginId })
      .map(({ repository }) => repository.id)
      .filter((repositoryId) => !disconnectedIds.has(repositoryId));
    for (const repositoryId of connectedIds) {
      await this.#host.disconnectExtensions({ pluginId, repositoryId, storeProject });
    }
    const changes = await this.#applications.disconnectMany(
      storeProject,
      pluginId,
      selectedIds,
    );
    if (connectedIds.length > 0 && remainingIds.length > 0) {
      const currentStoreProject = await this.#storeProjects.find(storeProject.root);
      for (const repositoryId of remainingIds) {
        await this.#host.connectExtensions({
          pluginId,
          repositoryId,
          storeProject: currentStoreProject,
        });
      }
    }
    return Object.freeze(changes.map((change, index) => new PluginDisconnectionResult({
      disconnected: change.changed,
      pluginId,
      repositoryId: selectedIds[index],
    })));
  }

  async status({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const value = await this.#host.status({ pluginId, repositoryId, storeProject });
    return statusResult(pluginId, repositoryId, value);
  }

  async statuses({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const connections = storeProject.project.pluginConnections({ pluginId, repositoryId });
    const repositories = storeProject.project.repositories.filter((repository) => (
      connections.some((connection) => connection.repository.id === repository.id)
    ));
    const groups = await this.#runner.run(repositories, async (repository) => {
      const results = [];
      for (const connection of connections.filter((entry) => (
        entry.repository.id === repository.id
      ))) {
        try {
          const value = await this.#host.status({
            pluginId: connection.pluginId,
            repositoryId: repository.id,
            storeProject,
          });
          results.push(statusResult(connection.pluginId, repository.id, value));
        } catch (error) {
          results.push(new PluginStatusResult({
            pluginId: connection.pluginId,
            repositoryId: repository.id,
            state: "unavailable",
            output: errorMessage(error),
          }));
        }
      }
      return results;
    });
    return Object.freeze(groups.flat());
  }

  async sync({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    return this.#host.sync({ pluginId, repositoryId, storeProject });
  }

  async syncMany({ start = process.cwd(), pluginId, repositoryIds } = {}) {
    return this.#invokeMany("sync", { start, pluginId, repositoryIds });
  }

  async exec({ start = process.cwd(), args, pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    return this.#host.exec({ args, pluginId, repositoryId, storeProject });
  }

  async execMany({ start = process.cwd(), args, pluginId, repositoryIds } = {}) {
    return this.#invokeMany("exec", { args, start, pluginId, repositoryIds });
  }

  async #invokeMany(operation, { args, start, pluginId, repositoryIds }) {
    const storeProject = await this.#storeProjects.find(start);
    const connections = selectConnections(storeProject.project, pluginId, repositoryIds);
    return this.#runner.run(
      connections.map(({ repository }) => repository),
      async (repository) => Object.freeze({
        output: await this.#host[operation]({
          ...(operation === "exec" ? { args } : {}),
          pluginId,
          repositoryId: repository.id,
          storeProject,
        }),
        pluginId,
        repositoryId: repository.id,
      }),
    );
  }
}
