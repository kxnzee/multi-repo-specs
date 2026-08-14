/** @fileoverview Безопасное чтение обязательных project files внутри доверенного root. */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Читает обычный относительный файл, блокируя symlink в каждом компоненте пути.
 *
 * @param {string} root Канонический корень проекта.
 * @param {string} relativePath Проверенный относительный путь.
 * @returns {Promise<string>} UTF-8 содержимое файла.
 */
export async function readRelativeRegularFile(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Некорректный относительный путь файла: ${relativePath ?? ""}`);
  }

  let current = root;
  const segments = relativePath.split(/[\\/]/);
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
