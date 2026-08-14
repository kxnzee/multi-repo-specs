/** @fileoverview Разрешение путей multi-repo workspace для connect. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { runCommand } from "../shared/command.js";

const WORKSPACE_CONFIG_KEY = "openspec-orch.workspace";

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние пути либо `null`.
 */
export async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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
    : commandRunner(
      "git",
      ["config", "--local", "--get", "--default", "", WORKSPACE_CONFIG_KEY],
      { cwd: storeRoot },
    );
  const storeParent = path.dirname(storeRoot);
  const standardWorkspace = (
    path.basename(storeRoot) === storeId &&
    path.basename(storeParent) !== "openspec" &&
    path.dirname(storeParent) !== storeParent
  ) ? storeParent : null;
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : configuredWorkspace
      ? path.resolve(configuredWorkspace)
      : standardWorkspace;
  if (!workspace) {
    throw new Error(
      `Не удалось определить workspace; разместите Store как <workspace>/${storeId} ` +
      "или один раз выполните openspec-orch connect --workspace <path>",
    );
  }
  const stat = await pathState(workspace);
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
 * @returns {void}
 */
export function rememberWorkspace(storeRoot, workspace, commandRunner = runCommand) {
  commandRunner(
    "git",
    ["config", "--local", "--replace-all", WORKSPACE_CONFIG_KEY, workspace],
    { cwd: storeRoot },
  );
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
  const stat = await pathState(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}
