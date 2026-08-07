/** @fileoverview Создание и проверка config-only OpenSpec pointer. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathState } from "./workspace.js";

const POINTER_PATH = path.join("openspec", "config.yaml");

/**
 * Создаёт или проверяет минимальный pointer Code Repository.
 *
 * @param {string} repositoryRoot Абсолютный путь Code Repository.
 * @param {string} storeId ID центрального Store.
 * @returns {Promise<boolean>} `true`, если pointer создан.
 */
export async function ensurePointer(repositoryRoot, storeId) {
  const openSpecRoot = path.join(repositoryRoot, "openspec");
  for (const directory of ["specs", "changes"]) {
    if (await pathState(path.join(openSpecRoot, directory))) {
      throw new Error(
        `${repositoryRoot} содержит локальный openspec/${directory}; требуется отдельная миграция`,
      );
    }
  }
  const pointerPath = path.join(repositoryRoot, POINTER_PATH);
  const pointerStat = await pathState(pointerPath);
  if (!pointerStat) {
    await fs.mkdir(openSpecRoot, { recursive: true });
    await fs.writeFile(pointerPath, `store: ${storeId}\n`, "utf8");
    return true;
  }
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${POINTER_PATH} должна быть обычным файлом`);
  }
  if ((await fs.readFile(pointerPath, "utf8")).replaceAll("\r\n", "\n") !== `store: ${storeId}\n`) {
    throw new Error(`${POINTER_PATH} должна содержать только 'store: ${storeId}'`);
  }
  return false;
}
