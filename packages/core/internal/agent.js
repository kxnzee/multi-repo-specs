/** @fileoverview Общий coordinator Agent contributions и Plugin Template. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CORE_PATTERNS } from "./constants.js";
import { pluginContexts } from "./plugin-context.js";
import { StoreProject } from "./store-project.js";
import { projectTemplates } from "./template.js";

/** Завершает проверку стабильной Agent integration ошибкой. */
function invalid(message) {
  throw new Error(`AGENT_INTEGRATION_INVALID: ${message}`);
}

/** Returns an optional ordinary Plugin Template directory. */
async function findTemplateRoot(pluginRoot) {
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0) return null;
  const candidate = path.join(pluginRoot, "template");
  let stat;
  try {
    stat = await fs.lstat(candidate);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    invalid("Plugin template должен быть обычным каталогом");
  }
  return candidate;
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
  #templates;

  constructor({
    contextFactory = pluginContexts,
    templateService = projectTemplates,
  } = {}) {
    if (typeof contextFactory?.forRepositorySetup !== "function") {
      invalid("contextFactory должен предоставлять forRepositorySetup");
    }
    if (
      typeof templateService?.plan !== "function" ||
      typeof templateService?.planPlugin !== "function" ||
      typeof templateService?.planOverlay !== "function"
    ) {
      invalid("templateService должен предоставлять plan, planPlugin и planOverlay");
    }
    this.#contexts = contextFactory;
    this.#templates = templateService;
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
    const hasContribution = plugin.hasAgentContribution();
    if (hasContribution) {
      const context = await this.#contexts.forRepositorySetup({
        loadedPlugin,
        repositoryId: storeProject.store.id,
        storeProject,
      });
      const contribution = await plugin.integrateAgent(context);
      let callbacks = contribution;
      if (contribution && Object.keys(contribution).length === 1 && Array.isArray(contribution.copy)) {
        const plan = await this.#templates.planOverlay({
          sourceRoot: loadedPlugin.root,
          targetRoot: storeProject.root,
          copy: contribution.copy,
        });
        callbacks = Object.freeze({
          install: () => plan.install(),
          remove: () => Object.freeze({ cleanupPaths: plan.targetPaths }),
        });
      }
      return new AgentIntegration({
        ...callbacks,
        agentId: context.agent.id,
        pluginId: plugin.id,
      });
    }
    const templateRoot = await findTemplateRoot(loadedPlugin.root);
    if (templateRoot) {
      const [agentId] = storeProject.project.agents;
      const plan = await this.#templates.planPlugin({
        templateRoot,
        targetRoot: storeProject.root,
        agentId,
      });
      return new AgentIntegration({
        agentId,
        pluginId: plugin.id,
        install: () => plan.install(),
        remove: () => Object.freeze({ cleanupPaths: plan.targetPaths }),
      });
    }
    return null;
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
