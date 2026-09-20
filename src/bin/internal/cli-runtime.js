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
  const authoringJson = group === "create" && argv.slice(3).includes("--json");
  if (authoringJson) {
    /** Suppresses Commander text so create errors preserve the JSON response. */
    const configure = (command) => {
      command.configureOutput({ writeErr: () => {} });
      for (const child of command.commands) configure(child);
    };
    configure(program);
  }
  try {
    if (argv.length === 2) program.outputHelp();
    else await program.parseAsync(argv);
  } catch (error) {
    if (!authoringJson || error.exitCode === 0) throw error;
    const code = error.code ?? error.message?.match(/^([A-Z_]+):/u)?.[1] ?? "AUTHORING_FAILED";
    process.stdout.write(`${JSON.stringify({ error: { code, message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
