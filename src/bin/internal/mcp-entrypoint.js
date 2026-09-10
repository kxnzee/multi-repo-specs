/** @fileoverview Runtime composition for the built-in Orchestrator Agent API. */

import process from "node:process";

import {
  OrchestratorMcpApplication,
  serveOrchestratorMcpStdio,
} from "@openspec-orch/mcp";

import { assertNodeVersion, createDistributionPlatform } from "./distribution.js";
import { OrchestratorMcpRuntime } from "./orchestrator-mcp-runtime.js";

/** Builds the MCP runtime from the same Core and Plugin services as the CLI. */
export async function runMcp({ start = process.cwd() } = {}) {
  assertNodeVersion(process.versions.node);
  const { loadAgentContributions, managerService, platform } = await createDistributionPlatform({ start });
  const runtime = new OrchestratorMcpRuntime({
    agentContributions: await loadAgentContributions(),
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
}
