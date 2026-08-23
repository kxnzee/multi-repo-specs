/** @fileoverview Public entrypoint for the CodeGraph Plugin. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { definePlugin } from "@openspec-orch/plugin-sdk";

const launcher = fileURLToPath(new URL("./bin/codegraph.js", import.meta.url));

/** Runs the package-owned CodeGraph binary in the current Repository checkout. */
function run(context, operation) {
  return context.process.run(process.execPath, [launcher, operation, "."]);
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
      return Object.freeze({
        state: "ready",
        details: await run(context, "status"),
      });
    },
    sync(context) {
      return run(context, "sync");
    },
  },
});

export default plugin;
