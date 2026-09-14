/** @fileoverview Единая граница ошибок для public CLI и stdio entrypoint. */

import process from "node:process";

/** Runs one public adapter and preserves its machine-visible exit convention. */
export async function runPublicEntrypoint({ name, run, commander = false } = {}) {
  try {
    await run();
  } catch (error) {
    if (commander && typeof error?.code === "string" && error.code.startsWith("commander.")) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
