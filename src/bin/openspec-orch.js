#!/usr/bin/env node

/** @fileoverview Точка входа OpenSpec Orchestrator CLI. */

import process from "node:process";
import { CommanderError } from "commander";
import { createProgram } from "../cli/program.js";

/**
 * Проверяет минимальную версию Node.js.
 *
 * @param {string} [version] Версия runtime в semver-формате.
 * @returns {void}
 * @throws {Error} Если major-версия меньше 20 или не распознана.
 */
export function assertNodeVersion(version = process.versions.node) {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 20) {
    throw new Error("OpenSpec Orchestrator requires Node.js 20 or newer");
  }
}

/**
 * Маршрутизирует аргументы процесса в пользовательскую команду.
 *
 * @returns {Promise<void>}
 */
async function main() {
  assertNodeVersion();
  const program = createProgram();
  if (process.argv.length === 2) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }
  console.error(`openspec-orch: ${error.message}`);
  process.exitCode = 1;
});
