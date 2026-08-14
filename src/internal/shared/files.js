/** @fileoverview Безопасное чтение обязательных project files внутри доверенного root. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { isContainedPath, isPortableRelativePath } from "./paths.js";

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние пути либо `null`.
 */
export async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Проверяет абсолютный существующий путь и запрещает выход или symlink относительно root.
 *
 * @param {string} root
 * @param {unknown} candidate
 * @param {string} label
 * @param {"directory" | "file"} kind
 * @returns {Promise<string>}
 */
export async function resolveContainedExistingPath(root, candidate, label, kind) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} должен быть абсолютным путём`);
  }
  const target = path.resolve(candidate);
  if (target !== candidate || !isContainedPath(root, target)) {
    throw new Error(`${label} выходит за разрешённый root`);
  }
  const [realTarget, stat] = await Promise.all([fs.realpath(target), fs.lstat(target)]);
  if (realTarget !== target || stat.isSymbolicLink()) {
    throw new Error(`${label} не должен содержать symlink`);
  }
  if ((kind === "directory" && !stat.isDirectory()) || (kind === "file" && !stat.isFile())) {
    throw new Error(`${label} должен быть обычным ${kind === "directory" ? "каталогом" : "файлом"}`);
  }
  return target;
}

/**
 * Проверяет объявленный путь, включая ещё не существующие пути и glob-сегменты.
 *
 * @param {string} root
 * @param {unknown} candidate
 * @param {string} label
 * @returns {Promise<string>}
 */
export async function resolveContainedDeclaredPath(root, candidate, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} должен быть абсолютным путём`);
  }
  const target = path.resolve(candidate);
  if (target !== candidate || !isContainedPath(root, target)) {
    throw new Error(`${label} выходит за разрешённый root`);
  }

  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} содержит symlink`);
  }
  return target;
}

/**
 * Читает обычный относительный файл, блокируя symlink в каждом компоненте пути.
 *
 * @param {string} root Канонический корень проекта.
 * @param {string} relativePath Проверенный относительный путь.
 * @returns {Promise<string>} UTF-8 содержимое файла.
 */
export async function readRelativeRegularFile(root, relativePath) {
  if (!isPortableRelativePath(relativePath, { allowDot: false })) {
    throw new Error(`Некорректный относительный путь файла: ${relativePath ?? ""}`);
  }

  let current = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`Отсутствует обычный файл ${relativePath}`);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Путь ${relativePath} содержит symlink`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`Путь ${relativePath} проходит через файл`);
    }
    if (final && !stat.isFile()) {
      throw new Error(`${relativePath} должна быть обычным файлом`);
    }
  }
  return fs.readFile(current, "utf8");
}
