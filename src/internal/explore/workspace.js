/** @fileoverview Разрешение центрального Store и multi-repo workspace для Explore. */

import path from "node:path";
import { lstatOrNull } from "../shared/files.js";
import { runOpenSpecJson } from "../shared/openspec.js";
import { findSpecRoot, requireStoreRoot } from "../shared/store.js";

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
    const stat = await lstatOrNull(cwd);
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
    const projectRoot = await requireStoreRoot(path.resolve(context.root.path));
    return { projectRoot, codeRoot, discovery: { doctor, context } };
  }
}
