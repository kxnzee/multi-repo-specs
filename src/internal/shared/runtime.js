/** @fileoverview Единая runtime-граница публичного CLI. */

import process from "node:process";

export const MINIMUM_NODE_VERSION = "20.19.0";

/**
 * Проверяет минимальную версию Node.js без зависимости от внешних пакетов.
 *
 * @param {string} [version] Версия runtime в semver-формате.
 * @returns {void}
 * @throws {Error} Если версия меньше 20.19.0 или не распознана.
 */
export function assertNodeVersion(version = process.versions.node) {
  const current = version.split(".").map(Number);
  const valid = current.length === 3 && current.every(Number.isInteger);
  const supported = valid && (
    current[0] > 20 ||
    (current[0] === 20 && current[1] >= 19)
  );
  if (!supported) {
    throw new Error(
      `OpenSpec Orchestrator требует Node.js ${MINIMUM_NODE_VERSION} или новее; ` +
        `текущая версия: ${version}`,
    );
  }
}
