/** @fileoverview Разделение Plugin domain model и внешнего CLI invocation. */

import assert from "node:assert/strict";
import test from "node:test";

import { createPluginClient, createPluginModel } from "../src/internal/plugin/index.js";

const DESCRIPTOR = Object.freeze({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  type: "cli",
  command: "demo-plugin",
  args: ["--team"],
  supports: ["code"],
  lifecycle: {
    connect: ["init", "."],
    status: ["status", "."],
  },
});

test("PluginModel owns scope and lifecycle invocation semantics", () => {
  const plugin = createPluginModel(DESCRIPTOR);
  plugin.assertSupports({ id: "frontend", role: "code" });
  assert.throws(
    () => plugin.assertSupports({ id: "specs", role: "store" }),
    /PLUGIN_SCOPE_UNSUPPORTED/,
  );
  assert.deepEqual(plugin.connectInvocation(), {
    command: "demo-plugin",
    args: ["--team", "init", "."],
  });
  assert.deepEqual(plugin.statusInvocation(), {
    command: "demo-plugin",
    args: ["--team", "status", "."],
  });
  assert.deepEqual(plugin.commandInvocation(["explore", "auth"]), {
    command: "demo-plugin",
    args: ["--team", "explore", "auth"],
  });
  assert.throws(() => plugin.syncInvocation(), /PLUGIN_SYNC_UNSUPPORTED/);
});

test("PluginClient only executes a prepared invocation in Repository cwd", async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return "done";
  };
  const client = createPluginClient("/workspace/frontend", runner);

  assert.equal(
    await client.execute({ command: "demo-plugin", args: ["status", "."] }),
    "done",
  );
  assert.deepEqual(calls, [{
    command: "demo-plugin",
    args: ["status", "."],
    cwd: "/workspace/frontend",
  }]);
});

test("PluginClient keeps descriptor command for a Package without entrypoint", async () => {
  const calls = [];
  const client = createPluginClient(
    "/workspace/frontend",
    async (command, args) => calls.push({ command, args }),
    {
      packageManifest: {
        openspecOrchestrator: {},
      },
    },
  );

  await client.execute({ command: "custom-plugin", args: ["status"] });
  assert.deepEqual(calls, [{ command: "custom-plugin", args: ["status"] }]);
});
