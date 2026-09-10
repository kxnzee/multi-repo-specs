/** @fileoverview Проверки Extension adapter над общим npm package supply. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ExtensionManagerService,
} from "@openspec-orch/core";

test("ExtensionManager restores missing npm runtime before native removal", async () => {
  const calls = [];
  const manager = new ExtensionManagerService({
    agentIds: ["qwen"],
    bundledProvider: { has() { return false; }, resolve() {} },
    supplyService: {
      forStore() {
        return {
          async resolve() {
            calls.push("resolve");
            throw Object.assign(new Error("runtime missing"), {
              code: "PACKAGE_RUNTIME_UNAVAILABLE",
            });
          },
          async sync() { calls.push("sync"); return true; },
        };
      },
    },
  }).forStore({});

  await manager.prepareRemoval("workflow");
  assert.deepEqual(calls, ["resolve", "sync"]);
});

test("ExtensionManager does not shadow a bundled Extension with an external package", async () => {
  const manager = new ExtensionManagerService({
    agentIds: ["qwen"],
    bundledProvider: {
      has(extensionId) { return extensionId === "workflow"; },
      resolve() { return Object.freeze({ id: "workflow" }); },
    },
    supplyService: { forStore() { return {}; } },
  }).forStore({});

  await assert.rejects(
    manager.install("workflow", "@test/workflow-extension@1.0.0"),
    /встроенную Extension нельзя заменить через --from/,
  );
});
