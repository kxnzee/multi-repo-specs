/** @fileoverview Интерактивный пользовательский lifecycle CLI Plugins. */

import path from "node:path";
import process from "node:process";
import { checkbox, input } from "@inquirer/prompts";

import {
  connectPluginRepositories,
  disconnectPlugin,
  discoverPlugins,
  initializePlugins,
  readPluginStatus,
  registerPluginPackage,
  removePlugin,
  syncPlugin,
} from "../../internal/plugin/index.js";
import { findSpecRoot, readStoreConfiguration } from "../../internal/shared/store.js";

const CUSTOM_SOURCE = "__custom_plugin_source__";

/**
 * Создаёт самостоятельный Plugin Package, не изменяя Core или Store.
 *
 * @param {{pluginId: string, target?: string, name?: string, supports?: string[]}} options
 * CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginRegister(options) {
  const targetRoot = options.target ?? path.join(process.cwd(), "plugins", options.pluginId);
  const result = await registerPluginPackage({
    pluginId: options.pluginId,
    targetRoot,
    name: options.name,
    supports: options.supports,
  });
  console.log(`${options.pluginId}: registered at ${result.root}`);
  console.log(`Entrypoint: ${result.entrypoint}`);
  console.log(
    `После реализации: openspec-orch plugin init --from ${result.root} --plugin ${options.pluginId}`,
  );
}

/**
 * Требует интерактивный терминал для checkbox-сценария.
 *
 * @returns {void}
 */
function requireInteractiveTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Интерактивный выбор требует TTY; используйте явные --plugin и --repo");
  }
}

/**
 * Выбирает Plugins из встроенного и пользовательского каталогов.
 *
 * @param {string[]} sourceRoots Начальные дополнительные источники.
 * @returns {Promise<{pluginIds: string[], sourceRoots: string[]}>} Выбор пользователя.
 */
async function promptForPlugins(sourceRoots) {
  requireInteractiveTerminal();
  let roots = [...sourceRoots];
  let discovered = await discoverPlugins(roots);
  const selected = await checkbox({
    message: "Выберите Plugins",
    choices: [
      ...discovered.map(({ descriptor }) => ({
        name: `${descriptor.name} (${descriptor.id})`,
        value: descriptor.id,
      })),
      { name: "Добавить Plugin Package", value: CUSTOM_SOURCE },
    ],
  });
  let pluginIds = selected.filter((id) => id !== CUSTOM_SOURCE);
  if (selected.includes(CUSTOM_SOURCE)) {
    const customRoot = await input({
      message: "Package, каталог, .tgz или Git URL",
    });
    roots = [...roots, customRoot];
    const previousIds = new Set(discovered.map(({ descriptor }) => descriptor.id));
    discovered = await discoverPlugins(roots);
    const customPlugins = discovered.filter(({ descriptor }) => !previousIds.has(descriptor.id));
    const customSelection = await checkbox({
      message: "Выберите пользовательские Plugins",
      choices: customPlugins.map(({ descriptor }) => ({
        name: `${descriptor.name} (${descriptor.id})`,
        value: descriptor.id,
      })),
    });
    pluginIds = [...pluginIds, ...customSelection];
  }
  return { pluginIds, sourceRoots: roots };
}

/**
 * Выполняет `plugin init` с checkbox UX либо явными non-interactive flags.
 *
 * @param {{pluginIds: string[], sourceRoots: string[], all: boolean}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginInit(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  let pluginIds = options.pluginIds;
  let sourceRoots = options.sourceRoots;
  if (options.all) {
    pluginIds = (await discoverPlugins(sourceRoots)).map(({ descriptor }) => descriptor.id);
  } else if (pluginIds.length === 0) {
    ({ pluginIds, sourceRoots } = await promptForPlugins(sourceRoots));
  }
  if (pluginIds.length === 0) {
    console.log("Plugins не выбраны.");
    return;
  }
  const result = await initializePlugins({ storeRoot, pluginIds, sourceRoots });
  for (const pluginId of result.initialized) console.log(`${pluginId}: initialized`);
  for (const pluginId of result.alreadyInitialized) console.log(`${pluginId}: already_initialized`);
  console.log("Далее: openspec-orch plugin connect <plugin-id>");
}

/**
 * Выполняет `plugin connect`, интерактивно выбирая repositories при отсутствии flags.
 *
 * @param {{pluginId: string, repositoryIds: string[]}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginConnect(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  let repositoryIds = options.repositoryIds;
  if (repositoryIds.length === 0) {
    requireInteractiveTerminal();
    const { project } = await readStoreConfiguration(storeRoot);
    repositoryIds = await checkbox({
      message: `Подключить ${options.pluginId} к repositories`,
      choices: project.repositories.map(({ id, role }) => ({
        name: `${id} [${role}]`,
        value: id,
      })),
    });
  }
  if (repositoryIds.length === 0) {
    console.log("Repositories не выбраны.");
    return;
  }
  const results = await connectPluginRepositories({
    storeRoot,
    pluginId: options.pluginId,
    repositoryIds,
  });
  for (const result of results) {
    console.log(`${options.pluginId} -> ${result.repositoryId}: ${result.connected ? "connected" : "already_connected"}`);
    if (result.output) console.log(result.output);
  }
}

/**
 * Выполняет read-only `plugin status`.
 *
 * @param {{pluginId?: string, repositoryId?: string, json: boolean}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginStatus(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const statuses = await readPluginStatus({
    storeRoot,
    pluginId: options.pluginId,
    repositoryId: options.repositoryId,
  });
  if (options.json) {
    console.log(JSON.stringify({ plugins: statuses }, null, 2));
    return;
  }
  if (statuses.length === 0) {
    console.log("Подключённые Plugins не найдены.");
    return;
  }
  for (const status of statuses) {
    console.log(`${status.pluginId} -> ${status.repositoryId}: ${status.state}`);
    if (status.output) console.log(`  ${status.output.replaceAll("\n", "\n  ")}`);
  }
}

/**
 * Выполняет `plugin sync`.
 *
 * @param {{pluginId: string, repositoryId: string}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginSync(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const output = await syncPlugin({ storeRoot, ...options });
  console.log(`${options.pluginId} -> ${options.repositoryId}: synced`);
  if (output) console.log(output);
}

/**
 * Выполняет `plugin disconnect` без удаления repository data.
 *
 * @param {{pluginId: string, repositoryId: string}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginDisconnect(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const disconnected = await disconnectPlugin({ storeRoot, ...options });
  console.log(`${options.pluginId} -> ${options.repositoryId}: ${disconnected ? "disconnected" : "not_connected"}`);
}

/**
 * Выполняет `plugin remove` после отключения от всех repositories.
 *
 * @param {{pluginId: string}} options CLI options.
 * @returns {Promise<void>}
 */
export async function runPluginRemove(options) {
  const storeRoot = await findSpecRoot(process.cwd());
  const removed = await removePlugin({ storeRoot, pluginId: options.pluginId });
  console.log(`${options.pluginId}: ${removed ? "removed" : "not_initialized"}`);
}
