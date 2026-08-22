/** @fileoverview Project selection и repository lifecycle Plugins. */

import { promises as fs } from "node:fs";
import path from "node:path";
import pMap from "p-map";

import { SERVICE_PATHS } from "../config/constants.js";
import { serializeNormalizedOrchestratorConfig } from "../config/index.js";
import { PROJECT_SETTINGS } from "../config/settings.js";
import { runCommand } from "../shared/command.js";
import { lstatOrNull, writeFileAtomic } from "../shared/files.js";
import { readStoreConfiguration } from "../shared/store.js";
import { resolveWorkspace } from "../shared/workspace.js";
import {
  discoverPlugins,
  installPluginPackage,
  readInstalledPluginPackage,
  removeInstalledPlugin,
} from "./catalog.js";
import { RESERVED_PLUGIN_IDS } from "./constants.js";
import { createPluginModel } from "./model.js";
import { createPluginClient } from "./plugin-client.js";

/**
 * Атомарно сохраняет project config.
 *
 * @param {string} storeRoot Store root.
 * @param {import("../config/project.js").ProjectModel} project Доменная модель проекта.
 * @returns {Promise<void>}
 */
async function writeProjectConfig(storeRoot, project) {
  await writeFileAtomic(
    path.join(storeRoot, SERVICE_PATHS.orchestratorConfig),
    serializeNormalizedOrchestratorConfig(project.toConfig()),
  );
}

/**
 * Разрешает Repository и его локальный root.
 *
 * @param {string} storeRoot Store root.
 * @param {import("../config/project.js").ProjectModel} project Доменная модель проекта.
 * @param {{id: string}} metadata Store metadata.
 * @param {string} repositoryId Repository ID.
 * @param {string} [workspace] Уже разрешённый workspace.
 * @returns {Promise<{repository: object, root: string}>}
 */
async function resolveRepository(storeRoot, project, metadata, repositoryId, workspace) {
  const repository = project.requireRepository(repositoryId);
  const requestedRoot = repository.role === "store"
    ? storeRoot
    : path.join(
      workspace ?? await resolveWorkspace(storeRoot, metadata.id),
      PROJECT_SETTINGS.workspace.repositoriesDirectory,
      repository.id,
    );
  const stat = await lstatOrNull(requestedRoot);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`REPO_NOT_CONNECTED: repository-id '${repository.id}' не подключён`);
  }
  return { repository, root: await fs.realpath(requestedRoot) };
}

/**
 * Создаёт привязанный client из проверенного project config.
 *
 * @param {object} options Параметры разрешения.
 * @param {string} options.storeRoot Store root.
 * @param {string} options.pluginId Plugin ID.
 * @param {string} options.repositoryId Repository ID.
 * @param {typeof runCommand} options.commandRunner Исполнитель Plugin CLI.
 * @param {{metadata: object, project: import("../config/project.js").ProjectModel}} [options.storeConfiguration]
 * Уже прочитанная конфигурация.
 * @param {object} [options.pluginPackage] Уже прочитанный Plugin Package.
 * @param {string} [options.workspace] Уже разрешённый workspace.
 * @returns {Promise<{project: object, repository: object, plugin: object, client: object}>} Plugin context.
 */
async function loadPluginContext({
  storeRoot,
  pluginId,
  repositoryId,
  commandRunner,
  storeConfiguration,
  pluginPackage: providedPluginPackage,
  workspace,
}) {
  const configuration = storeConfiguration ?? await readStoreConfiguration(storeRoot);
  const { metadata, project } = configuration;
  const { repository, root } = await resolveRepository(
    storeRoot,
    project,
    metadata,
    repositoryId,
    workspace,
  );
  const pluginPackage = providedPluginPackage ?? await readInstalledPluginPackage(storeRoot, pluginId);
  const { descriptor } = pluginPackage;
  const plugin = createPluginModel(descriptor);
  plugin.assertSupports(repository);
  const client = createPluginClient(root, commandRunner, pluginPackage);
  return { project, repository, plugin, client };
}

/** Загружает Plugin context и подтверждает существующую Repository binding. */
async function loadConnectedPluginContext(options) {
  const context = await loadPluginContext(options);
  if (!context.project.isPluginConnected(options.pluginId, options.repositoryId)) {
    throw new Error(
      `PLUGIN_NOT_CONNECTED: ${options.pluginId} не подключён к ${options.repositoryId}`,
    );
  }
  return context;
}

/** Импортирует выбранные Plugins в локальный cache Store и объявляет их в проекте. */
export async function initializePlugins({
  storeRoot,
  pluginIds,
  sourceRoots = [],
  packageInstaller = runCommand,
  commandRunner = runCommand,
}) {
  const { project } = await readStoreConfiguration(storeRoot);
  project.assertPluginInitializationAllowed();
  const discovered = await discoverPlugins(sourceRoots);
  const byId = new Map(discovered.map((plugin) => [plugin.descriptor.id, plugin]));
  const selected = [...new Set(pluginIds)];
  for (const pluginId of selected) {
    if (RESERVED_PLUGIN_IDS.has(pluginId)) {
      throw new Error(`PLUGIN_ID_RESERVED: plugin-id '${pluginId}' занят встроенной командой CLI`);
    }
    if (!byId.has(pluginId)) throw new Error(`PLUGIN_UNKNOWN: plugin-id '${pluginId}' не найден`);
    const plugin = createPluginModel(byId.get(pluginId).descriptor);
    if (plugin.hasAgentIntegration() && project.agents.length === 0) {
      throw new Error(
        `PLUGIN_AGENT_NOT_REGISTERED: для Plugin '${pluginId}' не зарегистрирован ни один Agent`,
      );
    }
  }

  const initialized = [];
  const alreadyInitialized = [];
  const agentIntegrations = [];
  for (const pluginId of selected) {
    const state = await installPluginPackage(storeRoot, byId.get(pluginId), packageInstaller);
    (state === "initialized" ? initialized : alreadyInitialized).push(pluginId);
    const pluginPackage = await readInstalledPluginPackage(storeRoot, pluginId);
    const plugin = createPluginModel(pluginPackage.descriptor);
    if (plugin.hasAgentIntegration()) {
      const client = createPluginClient(storeRoot, commandRunner, pluginPackage);
      for (const agentId of project.agents) {
        agentIntegrations.push({
          pluginId,
          agentId,
          output: await client.execute(plugin.agentInstallInvocation(agentId)),
        });
      }
    }
  }
  project.registerPlugins(selected);
  await writeProjectConfig(storeRoot, project);
  return { initialized, alreadyInitialized, agentIntegrations };
}

/** Подключает Plugin к нескольким repositories и сохраняет связи одной записью. */
export async function connectPluginRepositories({
  storeRoot,
  pluginId,
  repositoryIds,
  commandRunner = runCommand,
}) {
  const storeConfiguration = await readStoreConfiguration(storeRoot);
  const { metadata, project } = storeConfiguration;
  project.requirePlugin(pluginId);
  const selectedIds = [...new Set(repositoryIds)];
  const selectedRepositories = selectedIds.map((repositoryId) => project.requireRepository(repositoryId));
  const pluginPackage = await readInstalledPluginPackage(storeRoot, pluginId);
  const workspace = selectedRepositories.some(({ role }) => role === "code")
    ? await resolveWorkspace(storeRoot, metadata.id)
    : undefined;
  const results = await pMap(selectedRepositories, async (repository) => {
    const context = await loadPluginContext({
      storeRoot,
      pluginId,
      repositoryId: repository.id,
      commandRunner,
      storeConfiguration,
      pluginPackage,
      workspace,
    });
    if (project.isPluginConnected(pluginId, repository.id)) {
      return { repositoryId: repository.id, connected: false, output: "" };
    }
    return {
      repositoryId: repository.id,
      connected: true,
      output: await context.client.execute(context.plugin.connectInvocation()),
    };
  }, { concurrency: PROJECT_SETTINGS.plugins.processConcurrency });
  const connectedIds = new Set(
    results.filter(({ connected }) => connected).map(({ repositoryId }) => repositoryId),
  );
  if (connectedIds.size > 0) {
    project.connectPlugin(pluginId, connectedIds);
    await writeProjectConfig(storeRoot, project);
  }
  return results;
}

/** Подключает Plugin к одному Repository и выполняет его setup-команду. */
export async function connectPlugin(options) {
  const [result] = await connectPluginRepositories({
    ...options,
    repositoryIds: [options.repositoryId],
  });
  return { connected: result.connected, output: result.output };
}

/** Читает состояние всех либо выбранных Plugin connections. */
export async function readPluginStatus({ storeRoot, pluginId, repositoryId, commandRunner = runCommand }) {
  const storeConfiguration = await readStoreConfiguration(storeRoot);
  const { metadata, project } = storeConfiguration;
  const connections = project.pluginConnections({ pluginId, repositoryId })
    .map(({ repository, pluginId: currentPluginId }) => ({ repository, currentPluginId }));
  const workspace = connections.some(({ repository }) => repository.role === "code")
    ? await resolveWorkspace(storeRoot, metadata.id)
    : undefined;
  const pluginPackages = new Map();
  const readPluginPackage = (currentPluginId) => {
    if (!pluginPackages.has(currentPluginId)) {
      pluginPackages.set(currentPluginId, readInstalledPluginPackage(storeRoot, currentPluginId));
    }
    return pluginPackages.get(currentPluginId);
  };
  return pMap(connections, async ({ repository, currentPluginId }) => {
    try {
      const pluginPackage = await readPluginPackage(currentPluginId);
      const context = await loadPluginContext({
        storeRoot,
        pluginId: currentPluginId,
        repositoryId: repository.id,
        commandRunner,
        storeConfiguration,
        pluginPackage,
        workspace,
      });
      return {
        pluginId: currentPluginId,
        repositoryId: repository.id,
        state: "ready",
        output: await context.client.execute(context.plugin.statusInvocation()),
      };
    } catch (error) {
      return {
        pluginId: currentPluginId,
        repositoryId: repository.id,
        state: "unavailable",
        output: error.message,
      };
    }
  }, { concurrency: PROJECT_SETTINGS.plugins.processConcurrency });
}

/** Выполняет Plugin sync для подключённого Repository. */
export async function syncPlugin({ storeRoot, pluginId, repositoryId, commandRunner = runCommand }) {
  const context = await loadConnectedPluginContext({
    storeRoot,
    pluginId,
    repositoryId,
    commandRunner,
  });
  return context.client.execute(context.plugin.syncInvocation());
}

/** Удаляет связь Plugin с Repository без очистки его repository data. */
export async function disconnectPlugin({ storeRoot, pluginId, repositoryId }) {
  const { project } = await readStoreConfiguration(storeRoot);
  const disconnected = project.disconnectPlugin(pluginId, repositoryId);
  if (disconnected) await writeProjectConfig(storeRoot, project);
  return disconnected;
}

/** Удаляет неиспользуемый Plugin из project config и локального cache. */
export async function removePlugin({ storeRoot, pluginId, commandRunner = runCommand }) {
  const { project } = await readStoreConfiguration(storeRoot);
  if (!project.removePlugin(pluginId)) return false;
  const pluginPackage = await readInstalledPluginPackage(storeRoot, pluginId);
  const plugin = createPluginModel(pluginPackage.descriptor);
  if (plugin.hasAgentIntegration()) {
    const client = createPluginClient(storeRoot, commandRunner, pluginPackage);
    for (const agentId of project.agents) {
      await client.execute(plugin.agentRemoveInvocation(agentId));
    }
  }
  await removeInstalledPlugin(storeRoot, pluginId);
  await writeProjectConfig(storeRoot, project);
  return true;
}

/** Выполняет пользовательскую команду Plugin в связанном Repository. */
export async function runPluginCommand({
  storeRoot,
  pluginId,
  repositoryId,
  args,
  commandRunner = runCommand,
}) {
  const context = await loadConnectedPluginContext({
    storeRoot,
    pluginId,
    repositoryId,
    commandRunner,
  });
  return context.client.execute(context.plugin.commandInvocation(args));
}
