/** @fileoverview Разрешение центрального Store и multi-repo workspace для Explore. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveWorkspace as resolveConnectedWorkspace } from "../connect/workspace.js";
import { runOpenSpecJson } from "../shared/openspec.js";

const REQUIRED_ROOT_PATHS = Object.freeze([
  path.join(".openspec-store", "store.yaml"),
  "sdd.yaml",
  path.join("openspec", "config.yaml"),
  path.join("openspec", "context", "00-start-here.md"),
  path.join("openspec", "context", "system-map.yaml"),
]);

/**
 * Возвращает состояние пути, не считая отсутствие ошибкой.
 *
 * @param {string} target Проверяемый путь.
 * @returns {Promise<import("node:fs").Stats | null>} Состояние либо `null`.
 */
async function pathState(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Проверяет обязательные файлы Store и блокирует symlink до чтения.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<boolean>} Содержит ли каталог полный SDD skeleton.
 */
async function hasRequiredRoot(candidate) {
  const stats = await Promise.all(
    REQUIRED_ROOT_PATHS.map((relativePath) => pathState(path.join(candidate, relativePath))),
  );
  for (const [index, stat] of stats.entries()) {
    if (stat?.isSymbolicLink()) {
      throw new Error(`${REQUIRED_ROOT_PATHS[index]} должна быть обычным файлом`);
    }
  }
  return stats.every((stat) => stat?.isFile());
}

/**
 * Подтверждает обязательный SDD skeleton в Store.
 *
 * @param {string} candidate Предполагаемый Store.
 * @returns {Promise<string>} Канонический путь.
 */
async function requireProjectRoot(candidate) {
  if (!(await hasRequiredRoot(candidate))) {
    throw new Error(`Разрешённый Store не содержит обязательный SDD skeleton: ${candidate}`);
  }
  return fs.realpath(candidate);
}

/**
 * Находит центральный Store среди текущего каталога и родителей.
 *
 * @param {string} [start] Начальный путь.
 * @returns {Promise<string>} Канонический путь Store.
 */
export async function findSpecRoot(start = process.cwd()) {
  let candidate = path.resolve(start);
  const initial = await pathState(candidate);
  if (!initial) throw new Error(`Начальный путь не существует: ${candidate}`);
  if (!initial.isDirectory()) candidate = path.dirname(candidate);
  while (true) {
    if (await hasRequiredRoot(candidate)) return fs.realpath(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("Не удалось найти Spec Root среди родителей текущего каталога");
}

/**
 * Разрешает запуск из Store или подключённого Code Repository.
 *
 * @param {string} start Начальный путь.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель команд.
 * @returns {Promise<import("../shared/types.js").ExploreStartContext>} Store и discovery-контекст.
 */
export async function resolveStart(start, commandRunner) {
  try {
    return { projectRoot: await findSpecRoot(start), codeRoot: null, discovery: null };
  } catch (nearestError) {
    let cwd = path.resolve(start);
    const stat = await pathState(cwd);
    if (!stat) throw nearestError;
    if (!stat.isDirectory()) cwd = path.dirname(cwd);
    const codeRoot = path.resolve(commandRunner("git", ["rev-parse", "--show-toplevel"], { cwd }));
    const doctor = runOpenSpecJson(commandRunner, ["doctor", "--json"], codeRoot);
    const context = runOpenSpecJson(commandRunner, ["context", "--json"], codeRoot);
    if (!context.root?.path) {
      throw new Error("OpenSpec context не содержит root.path");
    }
    if (doctor.root?.source !== "declared" || context.root?.source !== "declared") {
      throw new Error("Code Repository не разрешил Store через project pointer");
    }
    if (
      doctor.root.store_id !== context.root.store_id ||
      path.resolve(doctor.root.path) !== path.resolve(context.root.path)
    ) {
      throw new Error("OpenSpec doctor и context разрешили разные Store");
    }
    const projectRoot = await requireProjectRoot(path.resolve(context.root.path));
    return { projectRoot, codeRoot, discovery: { doctor, context } };
  }
}

/**
 * Определяет общий корень постоянного workspace.
 *
 * @param {string} projectRoot Абсолютный путь Store.
 * @param {string} storeId Store ID из проверенных metadata.
 * @param {string | undefined} requestedWorkspace Явный workspace.
 * @param {typeof import("../shared/command.js").runCommand} commandRunner Исполнитель Git.
 * @returns {Promise<string>} Канонический путь workspace.
 */
export async function resolveWorkspace(projectRoot, storeId, requestedWorkspace, commandRunner) {
  return resolveConnectedWorkspace(projectRoot, storeId, requestedWorkspace, commandRunner);
}
