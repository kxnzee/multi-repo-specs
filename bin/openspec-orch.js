#!/usr/bin/env node

/** @fileoverview Public OpenSpec Orchestrator CLI adapter. */

import process from "node:process";

import {
  assertNodeVersion,
  createDistributionPlatform,
} from "./internal/distribution.js";

try {
  assertNodeVersion(process.versions.node);
  const { agentGatewayService, platform } = await createDistributionPlatform({
    start: process.cwd(),
  });
  const program = platform.createProgram({ agentGatewayService });
  if (process.argv.length === 2) program.outputHelp();
  else await program.parseAsync(process.argv);
} catch (error) {
  if (typeof error?.code === "string" && error.code.startsWith("commander.")) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    console.error(`openspec-orch: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
