/** @fileoverview Чтение и атомарная запись локального state OpenSpec Orchestrator. */

import { promises as fs } from "node:fs";
import path from "node:path";

import { CONTRACT_VERSIONS, SERVICE_PATHS } from "../config/constants.js";
import { lstatOrNull, writeFileAtomic } from "../shared/files.js";
import { parseStateSchema } from "./schema.js";

/**
 * Создаёт один служебный каталог и запрещает подмену symlink или файлом.
 *
 * @param {string} target Абсолютный путь каталога.
 * @param {string} label Название для диагностики.
 * @returns {Promise<void>}
 */
async function ensureStateDirectory(target, label) {
  const existing = await lstatOrNull(target);
  if (!existing) {
    try {
      await fs.mkdir(target, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`STATE_CORRUPTED: ${label} должен быть обычным каталогом`);
  }
}

/** @returns {ReturnType<typeof parseStateSchema>} Пустое локальное состояние. */
export function createEmptyState() {
  return parseStateSchema({ contract_version: CONTRACT_VERSIONS.state, workspace: null });
}

/**
 * Читает state; отсутствие файла означает чистое локальное состояние.
 *
 * @param {string} storeRoot Корень Store.
 * @returns {Promise<ReturnType<typeof parseStateSchema>>} Проверенное состояние.
 */
export async function readState(storeRoot) {
  const target = path.join(storeRoot, SERVICE_PATHS.state);
  const directoryStat = await lstatOrNull(path.dirname(target));
  if (directoryStat && (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())) {
    throw new Error(`STATE_CORRUPTED: ${SERVICE_PATHS.stateDirectory} должен быть обычным каталогом`);
  }
  const targetStat = await lstatOrNull(target);
  if (targetStat && (!targetStat.isFile() || targetStat.isSymbolicLink())) {
    throw new Error(`STATE_CORRUPTED: ${SERVICE_PATHS.state} должен быть обычным файлом`);
  }
  let source;
  try {
    source = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return createEmptyState();
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`STATE_CORRUPTED: ${SERVICE_PATHS.state} повреждён: ${error.message}`);
  }
  return parseStateSchema(payload);
}

/**
 * Проверяет и атомарно записывает state с mode 0600.
 *
 * @param {string} storeRoot Корень Store.
 * @param {unknown} state Новое состояние.
 * @returns {Promise<void>}
 */
export async function writeState(storeRoot, state) {
  const target = path.join(storeRoot, SERVICE_PATHS.state);
  const checked = parseStateSchema(state);
  await ensureStateDirectory(path.dirname(target), SERVICE_PATHS.stateDirectory);
  await writeFileAtomic(target, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Сериализует изменение локального state между процессами. При уже занятом lock
 * команда безопасно отказывает вместо перезаписи более свежего состояния.
 *
 * @template T
 * @param {string} storeRoot Корень Store.
 * @param {() => Promise<T>} operation Операция read-check-write.
 * @returns {Promise<T>} Результат операции.
 */
export async function withStateLock(storeRoot, operation) {
  const lockPath = path.join(storeRoot, SERVICE_PATHS.stateLock);
  await ensureStateDirectory(
    path.join(storeRoot, SERVICE_PATHS.stateDirectory),
    SERVICE_PATHS.stateDirectory,
  );
  await ensureStateDirectory(path.dirname(lockPath), SERVICE_PATHS.stateCacheDirectory);
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("STATE_BUSY: локальное состояние уже изменяется другой командой; повторите вызов");
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await fs.rmdir(lockPath);
  }
}
