/** @fileoverview Локальный воспроизводимый runtime шага 05. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import { lstatOrNull } from "../shared/files.js";
import { isContainedPath } from "../shared/paths.js";

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
    const stat = await lstatOrNull(current);
    if (!stat) {
      await fs.mkdir(current);
    } else if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Runtime path должен быть обычным каталогом: ${current}`);
    }
  }
  return current;
}

/**
 * Проверяет только границы безопасности перед передачей runtime агенту.
 *
 * @param {Record<string, unknown>} context Сформированный Core runtime.
 * @returns {void}
 */
function assertRuntimeBoundaries(context) {
  if (
    context.allowed_edit_roots?.length !== 1 ||
    context.allowed_edit_roots[0] !== context.code_root
  ) {
    throw new Error("OpenSpec Orchestrator отказался записать runtime: allowed_edit_roots должен содержать code_root");
  }
  if (!isContainedPath(context.spec_root, context.change_root)) {
    throw new Error("OpenSpec Orchestrator отказался записать runtime: change_root находится вне spec_root");
  }
  const contextFiles = Object.values(context.context_files).flat();
  if (contextFiles.some((file) => !isContainedPath(context.change_root, file))) {
    throw new Error("OpenSpec Orchestrator отказался записать runtime: context_files выходит за change_root");
  }
  const immutableRoots = context.immutable_roots;
  const validImmutableRoots = context.execution_mode === "strict"
    ? immutableRoots?.length === 1 && immutableRoots[0] === context.spec_root
    : immutableRoots?.length === 0;
  if (!validImmutableRoots) {
    throw new Error("OpenSpec Orchestrator отказался записать runtime: immutable_roots не соответствует execution_mode");
  }
}

/**
 * Удаляет только ранее проверенный локальный context, чтобы ошибка пересборки не оставила false-ready.
 *
 * @param {string} runtimeRoot
 * @returns {Promise<void>}
 */
export async function removeRuntimeContext(runtimeRoot) {
  await fs.rm(path.join(runtimeRoot, "context.json"), { force: true });
}

/**
 * Атомарно записывает минимальный context.
 *
 * @param {string} runtimeRoot
 * @param {Record<string, unknown>} context
 * @returns {Promise<string>}
 */
export async function writeRuntimeContext(runtimeRoot, context) {
  assertRuntimeBoundaries(context);
  const contextPath = path.join(runtimeRoot, "context.json");
  const temporary = path.join(runtimeRoot, `.context-${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(context, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, contextPath);
  return contextPath;
}
