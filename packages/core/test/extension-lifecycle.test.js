/** @fileoverview Автоматический lifecycle standalone Extensions без CLI-фасада. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { ExtensionLifecycle } from "../internal/extension-lifecycle.js";

/** Builds one two-Extension lifecycle while keeping native behavior injectable. */
function lifecycleFixture(invoke = async (_context, selected, request) => (
  `${selected.id}:${request.operation}`
)) {
  const calls = [];
  const declarations = Object.freeze([
    Object.freeze({ id: "first", source: "bundled:first" }),
    Object.freeze({ id: "second", source: "bundled:second" }),
  ]);
  const checkout = Object.freeze({ root: path.resolve("/workspace/specs") });
  const scopedProcess = Object.freeze({ async run() {} });
  const storeProject = Object.freeze({
    checkout,
    project: Object.freeze({
      agent: Object.freeze({ id: "qwen" }),
      extensionDeclarations: declarations,
    }),
    store: Object.freeze({ id: "specs" }),
  });
  const lifecycle = new ExtensionLifecycle({
    agentAdapter: Object.freeze({
      async preflight(context) {
        calls.push({ operation: "preflight", context });
        return "qwen 1.0.0";
      },
      async validateExtension(extension) {
        calls.push({ operation: "validate", extension: extension.id });
      },
      async invokeExtension(context, extension, request) {
        calls.push({ context, extension: extension.id, operation: request.operation });
        return invoke(context, extension, request);
      },
    }),
    bundledProvider: Object.freeze({
      resolve(declaration) {
        return Object.freeze({
          ...declaration,
          name: declaration.id,
          root: path.resolve(`/distribution/${declaration.id}`),
        });
      },
    }),
    processService: Object.freeze({
      forRepository(value) {
        assert.equal(value, checkout);
        return scopedProcess;
      },
    }),
    start: checkout.root,
    storeProjectService: Object.freeze({
      async resolve(start) {
        assert.equal(start, checkout.root);
        return storeProject;
      },
    }),
  });
  return { calls, lifecycle };
}

test("ExtensionLifecycle preflights and invokes the complete Store selection", async () => {
  const { calls, lifecycle } = lifecycleFixture();

  assert.equal(await lifecycle.preflight(), "qwen 1.0.0");
  assert.deepEqual(calls.map(({ operation, extension }) => [operation, extension]), [
    ["preflight", undefined],
    ["validate", "first"],
    ["validate", "second"],
  ]);

  calls.length = 0;
  assert.deepEqual(await lifecycle.connectSelected(), [
    "first:connect",
    "second:connect",
  ]);
  assert.deepEqual(calls.map(({ extension, operation }) => [extension, operation]), [
    ["first", "connect"],
    ["second", "connect"],
  ]);

  calls.length = 0;
  await lifecycle.disconnectSelected();
  assert.deepEqual(calls.map(({ extension, operation }) => [extension, operation]), [
    ["second", "disconnect"],
    ["first", "disconnect"],
  ]);
});

test("ExtensionLifecycle diagnoses every selected Extension after an independent failure", async () => {
  const { lifecycle } = lifecycleFixture(async (_context, selected) => {
    if (selected.id === "first") throw new Error("native registration is missing");
    return "enabled";
  });

  assert.deepEqual(await lifecycle.diagnoseSelected(), [
    {
      extensionId: "first",
      targetId: "specs",
      state: "unavailable",
      output: "EXTENSION_NATIVE_FAILED: first → specs: native registration is missing",
    },
    { extensionId: "second", targetId: "specs", state: "ready", output: "enabled" },
  ]);
});
