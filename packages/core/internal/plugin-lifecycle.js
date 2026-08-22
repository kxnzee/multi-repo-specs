/** @fileoverview Application service repository lifecycle одного Plugin. */

import process from "node:process";

import { pluginBindings } from "./plugin-binding.js";
import { PluginHost } from "./plugin-host.js";
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

/** Координирует Store lookup, Plugin Host и запись binding. */
export class PluginLifecycleService {
  #bindings;
  #host;
  #storeProjects;

  constructor({
    bindingService = pluginBindings,
    host,
    storeProjectService = storeProjects,
  } = {}) {
    if (!(host instanceof PluginHost)) {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginHost");
    }
    if (!bindingService || typeof bindingService.connect !== "function") {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется PluginBindingService");
    }
    if (!storeProjectService || typeof storeProjectService.find !== "function") {
      throw new Error("PLUGIN_LIFECYCLE_INVALID: требуется StoreProjectService");
    }
    this.#bindings = bindingService;
    this.#host = host;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async connect({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    this.#host.assertLoaded(pluginId);
    const change = await this.#bindings.connect(
      storeProject,
      pluginId,
      repositoryId,
      (current) => this.#host.connect({ pluginId, repositoryId, storeProject: current }),
    );
    return new PluginConnectionResult({
      connected: change.changed,
      output: change.output,
      pluginId,
      repositoryId,
    });
  }

  async status({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    return this.#host.status({ pluginId, repositoryId, storeProject });
  }

  async sync({ start = process.cwd(), pluginId, repositoryId } = {}) {
    const storeProject = await this.#storeProjects.find(start);
    return this.#host.sync({ pluginId, repositoryId, storeProject });
  }
}
