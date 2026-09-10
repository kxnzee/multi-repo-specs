/** @fileoverview Runtime composition for the public Orchestrator CLI. */

import process from "node:process";

import {
  assertNodeVersion,
  createDistributionPlatform,
  DISTRIBUTION_CONFIG,
  runBundledPluginRuntime,
} from "./distribution.js";

/** Builds and runs CLI grammar, or delegates a Plugin-owned native runtime. */
export async function runCli({ argv = process.argv, start = process.cwd() } = {}) {
  assertNodeVersion(process.versions.node);
  const [, , group, operation, pluginId, ...runtimeArgs] = argv;
  if (group === "plugin" && operation === "runtime") {
    await runBundledPluginRuntime(pluginId, runtimeArgs);
    return;
  }
  const { agentGatewayService, platform } = await createDistributionPlatform({
    start,
    loadInstalledPlugins: false,
  });
  const program = platform.createProgram({
    agentGatewayService,
    version: DISTRIBUTION_CONFIG.version,
  });
  if (argv.length === 2) program.outputHelp();
  else await program.parseAsync(argv);
}
