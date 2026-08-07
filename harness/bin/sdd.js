#!/usr/bin/env node

/** @fileoverview Точка входа SDD CLI. */

import process from "node:process";
import { HELP } from "../cli/args.js";
import { runConnect } from "../cli/connect.js";
import { runExplore } from "../cli/explore.js";
import { runInit } from "../cli/init.js";

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
    throw new Error("SDD requires Node.js 20 or newer");
  }
}

/**
 * Маршрутизирует аргументы процесса в пользовательскую команду.
 *
 * @returns {Promise<void>}
 */
async function main() {
  assertNodeVersion();

  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }
  if (command === "explore") return runExplore(args);
  if (command === "connect") return runConnect(args);
  if (command === "init") return runInit(args);
  throw new Error(`Неизвестная команда: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(`sdd: ${error.message}`);
  process.exitCode = 1;
});
