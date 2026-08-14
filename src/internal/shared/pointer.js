/** @fileoverview Создание и проверка config-only OpenSpec pointer. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { lstatOrNull } from "./files.js";

export const POINTER_PATH = "openspec/config.yaml";

/**
 * Читает строгий config-only pointer Code Repository.
 *
 * @param {string} repositoryRoot Абсолютный путь Code Repository.
 * @returns {Promise<string>} Store ID из pointer.
 */
export async function readPointer(repositoryRoot) {
  const pointerPath = path.join(repositoryRoot, POINTER_PATH);
  const pointerStat = await lstatOrNull(pointerPath);
  if (!pointerStat?.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${POINTER_PATH} должна быть обычным файлом`);
  }
  const source = (await fs.readFile(pointerPath, "utf8")).replaceAll("\r\n", "\n");
  const match = /^store: ([a-z0-9]+(?:-[a-z0-9]+)*)\n$/.exec(source);
  if (!match) {
    throw new Error(`${POINTER_PATH} должна содержать только 'store: <store-id>'`);
  }
  return match[1];
}

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
    if (await lstatOrNull(path.join(openSpecRoot, directory))) {
      throw new Error(
        `${repositoryRoot} содержит локальный openspec/${directory}; требуется отдельная миграция`,
      );
    }
  }
  const pointerPath = path.join(repositoryRoot, POINTER_PATH);
  const pointerStat = await lstatOrNull(pointerPath);
  if (!pointerStat) {
    await fs.mkdir(openSpecRoot, { recursive: true });
    await fs.writeFile(pointerPath, `store: ${storeId}\n`, "utf8");
    return true;
  }
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    throw new Error(`${POINTER_PATH} должна быть обычным файлом`);
  }
  if (await readPointer(repositoryRoot) !== storeId) {
    throw new Error(`${POINTER_PATH} должна содержать только 'store: ${storeId}'`);
  }
  return false;
}
