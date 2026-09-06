/** @fileoverview Проверки Extension adapter над общим npm package supply. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExtensionDeclaration,
  ExtensionManagerService,
} from "@openspec-orch/core";

/** Создаёт минимальный валидный npm Extension package. */
async function extensionPackage(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-extension-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "@test/workflow-extension",
    version: "1.0.0",
    openspecOrchestrator: { apiVersion: 1, extension: "./extension.yaml" },
  }));
  await fs.writeFile(path.join(root, "extension.yaml"), [
    "id: workflow",
    "name: Workflow",
    "manifests:",
    "  qwen: qwen-extension.json",
    "",
  ].join("\n"));
  await fs.writeFile(path.join(root, "qwen-extension.json"), "{}\n");
  return root;
}

test("ExtensionManager validates npm payload and restores it by stable ID", async (t) => {
  const packageRoot = await extensionPackage(t);
  const calls = [];
  const supplyService = {
    forStore() {
      return {
        async install(options) {
          calls.push(["install", options.kind, options.id, options.source]);
          const value = await options.validate(packageRoot);
          await options.publish(value);
          return value;
        },
        async resolve(kind, id) {
          calls.push(["resolve", kind, id]);
          return { packageRoot };
        },
        async sync() { calls.push(["sync"]); return true; },
      };
    },
  };
  const manager = new ExtensionManagerService({
    agentIds: ["qwen"],
    bundledProvider: { has() { return false; }, resolve() {} },
    supplyService,
  }).forStore({});
  let published;
  const installed = await manager.install("workflow", "/packages/workflow", async (value) => {
    published = value;
  });
  const restored = await manager.resolve(new ExtensionDeclaration("workflow"));

  assert.equal(installed, published);
  assert.equal(restored.id, "workflow");
  assert.equal(restored.source, "@test/workflow-extension@1.0.0");
  assert.deepEqual(calls, [
    ["install", "extensions", "workflow", "/packages/workflow"],
    ["resolve", "extensions", "workflow"],
  ]);
});

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
