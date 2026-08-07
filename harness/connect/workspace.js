/** @fileoverview Разрешение путей multi-repo workspace для connect. */

import { promises as fs } from "node:fs";
import path from "node:path";

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
 * Определяет общий workspace по стандартной раскладке или явному аргументу.
 *
 * @param {string} storeRoot Абсолютный путь центрального Store.
 * @param {string | undefined} requestedWorkspace Явно переданный workspace.
 * @returns {Promise<string>} Канонический абсолютный путь workspace.
 */
export async function resolveWorkspace(storeRoot, requestedWorkspace) {
  const workspace = requestedWorkspace
    ? path.resolve(requestedWorkspace)
    : path.basename(path.dirname(storeRoot)) === "openspec"
      ? path.dirname(path.dirname(storeRoot))
      : null;
  if (!workspace) {
    throw new Error(
      "Не удалось определить workspace; разместите Store в <workspace>/openspec/ или передайте --workspace",
    );
  }
  const stat = await pathState(workspace);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Workspace должен быть обычным каталогом: ${workspace}`);
  }
  return fs.realpath(workspace);
}
