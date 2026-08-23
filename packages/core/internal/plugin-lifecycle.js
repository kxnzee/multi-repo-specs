/** @fileoverview Application service repository lifecycle одного Plugin. */

import process from "node:process";

import { pluginApplications } from "./plugin-application.js";
import { PluginHost } from "./plugin-host.js";
import { repositoryRunner } from "./repository-operations.js";
import { storeProjects } from "./store-project.js";

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
  #storeProjects;

  constructor({
    applicationService = pluginApplications,
    host,
    repositoryRunnerService = repositoryRunner,
    storeProjectService = storeProjects,
  } = {}) {
    if (!(host instanceof PluginHost)) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginHost");
    }
    if (
      !applicationService ||
      typeof applicationService.connectMany !== "function" ||
      typeof applicationService.disconnect !== "function"
    ) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginApplicationService");
    }
    if (!repositoryRunnerService || typeof repositoryRunnerService.run !== "function") {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется RepositoryRunner");
    }
    if (!storeProjectService || typeof storeProjectService.find !== "function") {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется StoreProjectService");
    }
    this.#applications = applicationService;
    this.#host = host;
    this.#runner = repositoryRunnerService;
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
    return Object.freeze(changes.map((change, index) => new PluginConnectionResult({
      connected: change.changed,
      output: change.output,
      pluginId,
      repositoryId: selectedIds[index],
    })));
  }

  async disconnect({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    const change = await this.#applications.disconnect(storeProject, pluginId, repositoryId);
    return new PluginDisconnectionResult({
      disconnected: change.changed,
      pluginId,
      repositoryId,
    });
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
}
