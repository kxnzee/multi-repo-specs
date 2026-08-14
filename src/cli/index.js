/** @fileoverview Запуск публичного OpenSpec Orchestrator CLI. */

import process from "node:process";
import { CommanderError } from "commander";

import { createProgram } from "./program.js";

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
 * @param {string[]} [argv] Аргументы Node.js-процесса.
 * @returns {Promise<void>}
 */
export async function runCli(argv = process.argv) {
  try {
    assertNodeVersion();
    const program = createProgram();
    if (argv.length === 2) {
      program.outputHelp();
      return;
    }
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    console.error(`openspec-orch: ${error.message}`);
    process.exitCode = 1;
  }
}
