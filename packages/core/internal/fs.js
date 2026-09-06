/** @fileoverview Общие безопасные filesystem helpers Core. */

import { constants, promises as fs } from "node:fs";
import path from "node:path";

/** Reads the checked ordinary file through its verified handle, never by reopening its path. */
export async function readRegularFile(target) {
  const expected = await fs.lstat(target, { bigint: true });
  if (!expected.isFile() || expected.isSymbolicLink()) {
    throw new Error(`SAFE_PATH_INVALID: ${target} должен быть обычным файлом без symlink`);
  }
  // Windows has no O_NOFOLLOW; handle identity is checked there as on POSIX.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const handle = await fs.open(target, flags);
  try {
    const actual = await handle.stat({ bigint: true });
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new Error(`SAFE_PATH_INVALID: ${target} заменён после проверки`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

/** Возвращает lstat либо null только для отсутствующего path. */
export async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Создаёт каталог с защитой от конкурентного mkdir и возвращает его lstat. */
export async function ensureDirectory(target, { mode } = {}) {
  let stat = await lstatOrNull(target);
  if (!stat) {
    try {
      await fs.mkdir(target, mode === undefined ? undefined : { mode });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    stat = await fs.lstat(target);
  }
  return stat;
}

/** Creates and verifies an ordinary directory chain below an already trusted root. */
export async function ensureSafeDirectoryChain(root, relativePath, { mode } = {}) {
  let current = root;
  for (const segment of relativePath.split(/[\\/]/u).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await ensureDirectory(current, { mode });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`SAFE_PATH_INVALID: ${relativePath} содержит небезопасный каталог`);
    }
  }
  return current;
}

/** Requires an existing ordinary file/directory chain below an already trusted root. */
export async function requireSafePath(root, relativePath, kind = "file") {
  const segments = relativePath.split(/[\\/]/u).filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) throw new Error(`SAFE_PATH_INVALID: отсутствует ${relativePath}`);
    if (stat.isSymbolicLink()) throw new Error(`SAFE_PATH_INVALID: ${relativePath} содержит symlink`);
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`SAFE_PATH_INVALID: ${relativePath} проходит через файл`);
    }
    const correctKind = kind === "file" ? stat.isFile() : stat.isDirectory();
    if (final && !correctKind) {
      const label = kind === "file" ? "файлом" : "каталогом";
      throw new Error(`SAFE_PATH_INVALID: ${relativePath} должен быть обычным ${label}`);
    }
  }
  return current;
}
