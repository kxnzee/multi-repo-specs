/** @fileoverview Локальный воспроизводимый runtime шага 05. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isGitRevision, isRecord } from "../shared/schema.js";

const CONTEXT_KEYS = [
  "version",
  "step_status",
  "store_id",
  "change_id",
  "spec_baseline",
  "spec_root",
  "repository_id",
  "code_root",
  "implementation_branch",
  "code_base_revision",
  "work_packages",
  "allowed_edit_roots",
  "immutable_roots",
];

/**
 * Создаёт runtime-каталог, запрещая symlink на каждом принадлежащем OpenSpec Orchestrator сегменте.
 *
 * @param {string} workspace
 * @param {string[]} segments
 * @returns {Promise<string>}
 */
export async function ensureRuntimeDirectory(workspace, segments) {
  let current = workspace;
  for (const segment of [".openspec-orch", "runtime", ...segments]) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!stat) {
      await fs.mkdir(current);
    } else if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Runtime path должен быть обычным каталогом: ${current}`);
    }
  }
  return current;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRuntimeContext(value) {
  if (!isRecord(value) || Object.keys(value).sort().join("\0") !== [...CONTEXT_KEYS].sort().join("\0")) {
    return false;
  }
  const workPackages = Array.isArray(value.work_packages) ? value.work_packages : [];
  return (
    value.version === 1 &&
    value.step_status === "implementation_ready" &&
    ["store_id", "change_id", "spec_root", "repository_id", "code_root", "implementation_branch"]
      .every((key) => typeof value[key] === "string") &&
    isGitRevision(value.spec_baseline) &&
    isGitRevision(value.code_base_revision) &&
    path.isAbsolute(value.spec_root) && path.isAbsolute(value.code_root) &&
    workPackages.length > 0 && new Set(workPackages).size === workPackages.length &&
    workPackages.every((item) => typeof item === "string" && item.length > 0) &&
    Array.isArray(value.allowed_edit_roots) && value.allowed_edit_roots.length === 1 &&
    value.allowed_edit_roots.every((item) => typeof item === "string" && path.isAbsolute(item)) &&
    Array.isArray(value.immutable_roots) && value.immutable_roots.length === 1 &&
    value.immutable_roots.every((item) => typeof item === "string" && path.isAbsolute(item))
  );
}

/**
 * Удаляет только ранее проверенный локальный context, чтобы ошибка пересборки не оставила false-ready.
 *
 * @param {string} runtimeRoot
 * @returns {Promise<void>}
 */
export async function removeRuntimeContext(runtimeRoot) {
  const contextPath = path.join(runtimeRoot, "context.json");
  try {
    await fs.unlink(contextPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/**
 * Атомарно записывает минимальный context.
 *
 * @param {string} runtimeRoot
 * @param {Record<string, unknown>} context
 * @returns {Promise<string>}
 */
export async function writeRuntimeContext(runtimeRoot, context) {
  if (!isRuntimeContext(context)) throw new Error("OpenSpec Orchestrator сформировал некорректный runtime context");
  const contextPath = path.join(runtimeRoot, "context.json");
  const temporary = path.join(runtimeRoot, `.context-${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(context, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, contextPath);
  return contextPath;
}
