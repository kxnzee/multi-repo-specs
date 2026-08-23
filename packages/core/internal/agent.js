/** @fileoverview Общий coordinator Agent contributions через безопасный PluginContext. */

import { CORE_PATTERNS } from "./constants.js";
import { pluginContexts } from "./plugin-context.js";
import { StoreProject } from "./store-project.js";

/** Завершает проверку стабильной Agent integration ошибкой. */
function invalid(message) {
  throw new Error(`AGENT_INTEGRATION_INVALID: ${message}`);
}

/** Immutable executable contribution одного Plugin для выбранного Agent. */
export class AgentIntegration {
  #agentId;
  #install;
  #pluginId;
  #remove;

  constructor({ agentId, install, pluginId, remove } = {}) {
    if (typeof agentId !== "string" || !CORE_PATTERNS.id.test(agentId)) {
      invalid("agentId обязателен");
    }
    if (typeof pluginId !== "string" || !CORE_PATTERNS.pluginId.test(pluginId)) {
      invalid("pluginId обязателен");
    }
    if (typeof install !== "function" || typeof remove !== "function") {
      invalid("Plugin должен предоставить install и remove");
    }
    this.#agentId = agentId;
    this.#install = install;
    this.#pluginId = pluginId;
    this.#remove = remove;
    Object.freeze(this);
  }

  get agentId() { return this.#agentId; }
  get pluginId() { return this.#pluginId; }
  install() { return this.#install(); }
  remove() { return this.#remove(); }
}

/** Разрешает и выполняет Agent contribution, не зная Plugin ID или provider format. */
export class AgentService {
  #contexts;

  constructor({ contextFactory = pluginContexts } = {}) {
    if (typeof contextFactory?.forRepositorySetup !== "function") {
      invalid("contextFactory должен предоставлять forRepositorySetup");
    }
    this.#contexts = contextFactory;
    Object.freeze(this);
  }

  async resolve(storeProject, loadedPlugin) {
    if (!(storeProject instanceof StoreProject)) invalid("требуется StoreProject");
    const plugin = loadedPlugin?.plugin;
    if (
      !plugin ||
      typeof plugin.hasAgentContribution !== "function" ||
      typeof plugin.integrateAgent !== "function"
    ) {
      invalid("требуется загруженный Plugin public API");
    }
    if (!plugin.hasAgentContribution()) return null;
    const context = await this.#contexts.forRepositorySetup({
      loadedPlugin,
      repositoryId: storeProject.store.id,
      storeProject,
    });
    return new AgentIntegration({
      ...(await plugin.integrateAgent(context)),
      agentId: context.agent.id,
      pluginId: plugin.id,
    });
  }

  install(storeProject, integration) {
    this.#assertInput(storeProject, integration);
    return integration.install();
  }

  remove(storeProject, integration) {
    this.#assertInput(storeProject, integration);
    return integration.remove();
  }

  #assertInput(storeProject, integration) {
    if (!(storeProject instanceof StoreProject) || !(integration instanceof AgentIntegration)) {
      invalid("требуются StoreProject и AgentIntegration");
    }
  }
}

/** Общий Agent Service нового Core. */
export const agentIntegrations = Object.freeze(new AgentService());
