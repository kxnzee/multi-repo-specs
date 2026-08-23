/** @fileoverview Public entrypoint for the CodeGraph Plugin. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { definePlugin } from "@openspec-orch/plugin-sdk";

import { CodeGraphRepositoryStatus } from "./lib/repository.js";

const launcher = fileURLToPath(new URL("./bin/codegraph.js", import.meta.url));

/** Runs the package-owned CodeGraph binary in the current Repository checkout. */
function run(context, operation, ...args) {
  return context.process.run(process.execPath, [launcher, operation, ".", ...args]);
}

const plugin = definePlugin({
  id: "codegraph",
  supports: ["store", "code"],
  agent: {
    integration(context) {
      const invoke = (operation) => context.process.run(
        process.execPath,
        [launcher, "agent", operation, "--agent", context.agent.id],
      );
      return Object.freeze({
        install() { return invoke("install"); },
        remove() { return invoke("remove"); },
      });
    },
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
  },
});

export default plugin;
