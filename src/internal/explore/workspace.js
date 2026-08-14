/** @fileoverview Разрешение центрального Store и multi-repo workspace для Explore. */

import path from "node:path";
import { lstatOrNull } from "../shared/files.js";
import { createGitClient } from "../shared/git-client.js";
import { parseOpenSpecRoot, runOpenSpecJson } from "../shared/openspec.js";
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
    const codeRoot = await createGitClient(cwd, commandRunner).repositoryRoot();
    const doctor = await runOpenSpecJson(commandRunner, ["doctor", "--json"], codeRoot);
    const context = await runOpenSpecJson(commandRunner, ["context", "--json"], codeRoot);
    const doctorRoot = parseOpenSpecRoot(doctor.root, "openspec doctor --json");
    const contextRoot = parseOpenSpecRoot(context.root, "openspec context --json");
    if (doctorRoot.source !== "declared" || contextRoot.source !== "declared") {
      throw new Error(
        "OpenSpec Orchestrator ожидал, что Code Repository разрешит Store " +
          "через project pointer (root.source=declared)",
      );
    }
    if (
      doctorRoot.store_id !== contextRoot.store_id ||
      path.resolve(doctorRoot.path) !== path.resolve(contextRoot.path)
    ) {
      throw new Error(
        "OpenSpec Orchestrator получил разные Store identity из `openspec doctor --json` " +
          "и `openspec context --json`",
      );
    }
    const projectRoot = await requireStoreRoot(path.resolve(contextRoot.path));
    return { projectRoot, codeRoot, discovery: { doctor, context } };
  }
}
