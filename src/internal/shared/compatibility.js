/** @fileoverview Capability-based совместимость с внешним OpenSpec CLI. */

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Проверяет только наличие работоспособного OpenSpec CLI и машинно читаемой версии.
 * Совместимость рабочих команд определяется их фактическими JSON capabilities.
 *
 * @param {typeof import("./command.js").runCommand} commandRunner
 * @param {string} cwd
 * @returns {string}
 */
export function inspectOpenSpecCli(commandRunner, cwd) {
  const version = commandRunner("openspec", ["--version"], { cwd }).trim();
  if (!VERSION_PATTERN.test(version)) {
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
