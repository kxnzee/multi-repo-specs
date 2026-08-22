/** @fileoverview Запуск публичного OpenSpec Orchestrator CLI. */

import process from "node:process";
import { CommanderError } from "commander";

import { createProgram } from "./program.js";
import { routeNativePluginCommand } from "../internal/plugin/index.js";
import { assertNodeVersion } from "../internal/shared/runtime.js";

/**
 * Маршрутизирует аргументы процесса в пользовательскую команду.
 *
 * @param {string[]} [argv] Аргументы Node.js-процесса.
 * @returns {Promise<void>}
 */
export async function runCli(argv = process.argv) {
  try {
    assertNodeVersion();
    const routedPlugin = await routeNativePluginCommand(argv.slice(2), { cwd: process.cwd() });
    if (routedPlugin) {
      if (routedPlugin.output) console.log(routedPlugin.output);
      return;
    }
    const program = createProgram();
    if (argv.length === 2) {
      program.outputHelp();
      return;
    }
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }
    console.error(`openspec-orch: ${error.message}`);
    process.exitCode = 1;
  }
}
