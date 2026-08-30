#!/usr/bin/env node

/** @fileoverview Composition root for the built-in Orchestrator Agent API. */

import process from "node:process";

import {
  OrchestratorMcpApplication,
  serveOrchestratorMcpStdio,
} from "@openspec-orch/mcp";

import { assertNodeVersion, createDistributionPlatform } from "./internal/distribution.js";
import { OrchestratorMcpRuntime } from "./internal/orchestrator-mcp-runtime.js";

try {
  assertNodeVersion(process.versions.node);
  const start = process.cwd();
  const { managerService, platform } = await createDistributionPlatform({ start });
  const runtime = new OrchestratorMcpRuntime({
    doctorService: Object.freeze({
      inspect: (options) => platform.inspectDoctor(options),
    }),
    managerService,
    setupService: Object.freeze({
      connect: () => platform.connectProject(),
      initialize: (input) => platform.initializeProject(input),
      inspect: () => platform.inspectSetup(),
    }),
    start,
  });
  await serveOrchestratorMcpStdio(new OrchestratorMcpApplication({ runtime }));
} catch (error) {
  console.error(`openspec-orch-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
