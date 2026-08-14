/** @fileoverview Разрешение и сохранение путей multi-repo workspace. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { runCommand } from "./command.js";
import { lstatOrNull } from "./files.js";
import { createGitClient } from "./git-client.js";

const WORKSPACE_CONFIG_KEY = "openspec-orch.workspace";

/**
 * Определяет стандартный workspace для Store в раскладке `<workspace>/<store-id>`.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} storeId Store ID из проверенных metadata.
 * @returns {string | null} Путь workspace либо `null` для нестандартной раскладки.
 */
export function inferStandardWorkspace(storeRoot, storeId) {
  const workspace = path.dirname(storeRoot);
  return (
    path.basename(storeRoot) === storeId &&
    path.basename(workspace) !== "openspec" &&
    path.dirname(workspace) !== workspace
  ) ? workspace : null;
}

/**
 * Определяет общий workspace по явному аргументу, локальной Git-настройке
 * или стандартной раскладке `<workspace>/<store-id>`.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} storeId Store ID из проверенных metadata.
 * @param {string | undefined} requestedWorkspace Явно переданный workspace.
 * @param {typeof runCommand} [commandRunner] Исполнитель Git.
 * @param {boolean} [useGitConfig] Читать локальную Git-настройку workspace.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
export async function resolveWorkspace(
  storeRoot,
  storeId,
  requestedWorkspace,
  commandRunner = runCommand,
  useGitConfig = true,
) {
  const configuredWorkspace = requestedWorkspace || !useGitConfig
    ? ""
    : await createGitClient(storeRoot, commandRunner).configValue(WORKSPACE_CONFIG_KEY);
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : configuredWorkspace
      ? path.resolve(configuredWorkspace)
      : inferStandardWorkspace(storeRoot, storeId);
  if (!workspace) {
    throw new Error(
      `Не удалось определить workspace; разместите Store как <workspace>/${storeId} ` +
      "или один раз выполните openspec-orch connect --workspace <path>",
    );
  }
  const stat = await lstatOrNull(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    if (configuredWorkspace) {
      throw new Error(
        `Сохранённый workspace недоступен: ${workspace}; повторите openspec-orch connect --workspace <path>`,
      );
    }
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}

/**
 * Запоминает проверенный workspace только в локальной Git-конфигурации Store.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string} workspace Канонический абсолютный путь workspace.
 * @param {typeof runCommand} [commandRunner] Исполнитель Git.
 * @returns {Promise<void>}
 */
export async function rememberWorkspace(storeRoot, workspace, commandRunner = runCommand) {
  await createGitClient(storeRoot, commandRunner).setConfigValue(WORKSPACE_CONFIG_KEY, workspace);
}

/**
 * Определяет workspace по стандартному checkout `<workspace>/src/<repository-id>`.
 * `openspec-orch connect` всегда размещает Code Repositories именно в этой структуре, включая
 * сценарий с явно заданным workspace и Store вне `<workspace>/openspec/`.
 *
 * @param {string} repositoryRoot Канонический корень Code Repository.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
export async function resolveCodeWorkspace(repositoryRoot) {
  const sourceRoot = path.dirname(repositoryRoot);
  if (path.basename(sourceRoot) !== "src") {
    throw new Error(`Code Repository должен находиться в <workspace>/src/: ${repositoryRoot}`);
  }
  const workspace = path.dirname(sourceRoot);
  const stat = await lstatOrNull(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}
