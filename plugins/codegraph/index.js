/** @fileoverview Public entrypoint for the CodeGraph Plugin. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { definePlugin, REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { CodeGraphRepositoryStatus } from "./lib/repository.js";

const launcher = fileURLToPath(new URL("./bin/codegraph.js", import.meta.url));

/** Runs the package-owned CodeGraph binary in the current Repository checkout. */
function run(context, operation, ...args) {
  return context.process.run(process.execPath, [launcher, operation, ".", ...args]);
}

const plugin = definePlugin({
  id: "codegraph",
  supports: [REPOSITORY_ROLE.store, REPOSITORY_ROLE.code],
  extensions(context) {
    return [{
      id: "agent",
      root: "./extension",
      target: context.repository,
    }];
  },
  repository: {
    connect(context) {
      return run(context, "init");
    },
    async status(context) {
      const details = await run(context, "status", "--json");
      return new CodeGraphRepositoryStatus(details).toPluginStatus();
    },
    sync(context) {
      return run(context, "sync");
    },
    exec(context, args) {
      return context.process.run(process.execPath, [launcher, ...args]);
    },
  },
});

export default plugin;
