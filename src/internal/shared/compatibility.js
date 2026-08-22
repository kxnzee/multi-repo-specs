/** @fileoverview Capability-based совместимость с внешним OpenSpec CLI. */

import { CONTRACT_PATTERNS } from "../config/constants.js";
import { createOpenSpecClient } from "./openspec-client.js";

/**
 * Проверяет только наличие работоспособного OpenSpec CLI и машинно читаемой версии.
 * Совместимость рабочих команд определяется их фактическими JSON capabilities.
 *
 * @param {typeof import("./command.js").runCommand} commandRunner
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function inspectOpenSpecCli(commandRunner, cwd) {
  const version = (await createOpenSpecClient(cwd, commandRunner).execute(["--version"])).trim();
  if (!CONTRACT_PATTERNS.semanticVersion.test(version)) {
    throw new Error(
      "OpenSpec Orchestrator не может определить версию OpenSpec CLI: " +
        "ожидалась semantic version",
    );
  }
  return version;
}

/**
 * Возвращает конкретную ошибку отсутствующего JSON capability.
 *
 * @param {unknown} condition
 * @param {string} capability
 * @returns {asserts condition}
 */
export function requireOpenSpecCapability(condition, capability) {
  if (!condition) {
    throw new Error(`OpenSpec Orchestrator требует JSON capability: ${capability}`);
  }
}
