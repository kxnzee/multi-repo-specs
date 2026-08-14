/** @fileoverview Локальный воспроизводимый runtime шага 05. */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import * as z from "zod";

import { lstatOrNull } from "../shared/files.js";
import { isContainedPath } from "../shared/paths.js";
import { isGitRevision } from "../shared/schema.js";

const NON_EMPTY_STRING = z.string().min(1);
const ABSOLUTE_PATH = NON_EMPTY_STRING.refine(path.isAbsolute);
const UNIQUE_STRINGS = z.array(NON_EMPTY_STRING).refine(
  (items) => new Set(items).size === items.length,
);
const REVISION = z.union([z.string().refine(isGitRevision), z.literal("unpinned")]);
const RUNTIME_CONTEXT_SCHEMA = z.strictObject({
  version: z.literal(2),
  step_status: z.literal("implementation_ready"),
  execution_mode: z.enum(["strict", "relaxed"]),
  store_id: NON_EMPTY_STRING,
  change_id: NON_EMPTY_STRING,
  spec_baseline: REVISION,
  spec_root: ABSOLUTE_PATH,
  repository_id: NON_EMPTY_STRING,
  code_root: ABSOLUTE_PATH,
  implementation_branch: NON_EMPTY_STRING.nullable(),
  code_base_revision: REVISION,
  schema: NON_EMPTY_STRING,
  implementation_mode: z.enum(["package", "whole-change"]),
  change_root: ABSOLUTE_PATH,
  context_files: z.record(NON_EMPTY_STRING, z.array(ABSOLUTE_PATH)),
  work_packages: UNIQUE_STRINGS,
  allowed_edit_roots: z.array(ABSOLUTE_PATH).length(1),
  immutable_roots: z.array(ABSOLUTE_PATH).max(1),
}).refine((context) => context.execution_mode === "strict"
  ? isGitRevision(context.spec_baseline) && isGitRevision(context.code_base_revision) &&
    context.implementation_branch !== null && context.immutable_roots[0] === context.spec_root
  : context.spec_baseline === "unpinned" && context.code_base_revision === "unpinned" &&
    context.implementation_branch === null && context.immutable_roots.length === 0
).refine((context) => isContainedPath(context.spec_root, context.change_root)
).refine((context) => context.implementation_mode === "package"
  ? context.work_packages.length > 0
  : context.work_packages.length === 0
).refine((context) => Object.values(context.context_files).every((files) =>
  files.every((file) => isContainedPath(context.change_root, file))));

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

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRuntimeContext(value) {
  return RUNTIME_CONTEXT_SCHEMA.safeParse(value).success;
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
  if (!isRuntimeContext(context)) throw new Error("OpenSpec Orchestrator сформировал некорректный runtime context");
  const contextPath = path.join(runtimeRoot, "context.json");
  const temporary = path.join(runtimeRoot, `.context-${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(context, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, contextPath);
  return contextPath;
}
