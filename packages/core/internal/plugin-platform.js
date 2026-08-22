/** @fileoverview Composition root независимой Plugin Platform нового Core. */

import { CandidateCli } from "./cli.js";
import { pluginContexts } from "./plugin-context.js";
import { PluginLifecycleCommands } from "./plugin-cli.js";
import { PluginCommandMounter } from "./plugin-commands.js";
import { PluginHost, PluginRegistry } from "./plugin-host.js";
import { PluginLifecycleService } from "./plugin-lifecycle.js";

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
    this.#lifecycle = new PluginLifecycleService({ host: this.#host });
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
