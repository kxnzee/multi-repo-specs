#!/usr/bin/env node

/** @fileoverview Точка входа OpenSpec Orchestrator CLI. */

import process from "node:process";
import { assertNodeVersion } from "../internal/shared/runtime.js";

try {
  assertNodeVersion();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  const { runCli } = await import("../cli/index.js");
  await runCli();
}
