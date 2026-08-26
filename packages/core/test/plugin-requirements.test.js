/** @fileoverview Contract of Project Template required Plugin reconciliation. */

import assert from "node:assert/strict";
import test from "node:test";

import { PluginRequirementsService } from "@openspec-orch/core";

test("PluginRequirementsService installs catalog entries and persists the exact required set", async () => {
  const calls = [];
  const storeProject = Object.freeze({ root: "/store" });
  const service = new PluginRequirementsService({
    applicationService: {
      async install(current, id, source, options) {
        calls.push({ operation: "install", current, id, source, options });
        return { initialized: id === "openspec-graph" };
      },
      async setRequiredPlugins(current, ids) {
        calls.push({ operation: "set", current, ids });
      },
    },
    catalog: {
      select(ids) {
        assert.deepEqual(ids, ["openspec-graph"]);
        return [{ id: "openspec-graph", source: "bundled-source" }];
      },
    },
    storeProjectService: {
      async load(root) {
        assert.equal(root, "/store");
        return storeProject;
      },
    },
  });

  const result = await service.reconcile("/store", ["openspec-graph"]);

  assert.deepEqual(result.required, ["openspec-graph"]);
  assert.deepEqual(result.initialized, ["openspec-graph"]);
  assert.deepEqual(calls, [
    {
      operation: "install",
      current: storeProject,
      id: "openspec-graph",
      source: "bundled-source",
      options: { required: true },
    },
    { operation: "set", current: storeProject, ids: ["openspec-graph"] },
  ]);
});

test("PluginRequirementsService keeps removed requirements installed but marks none required", async () => {
  const calls = [];
  const service = new PluginRequirementsService({
    applicationService: {
      async install() { throw new Error("unexpected install"); },
      async setRequiredPlugins(current, ids) { calls.push({ current, ids }); },
    },
    catalog: { select(ids) { assert.deepEqual(ids, []); return []; } },
    storeProjectService: { async load() { return "store-project"; } },
  });

  const result = await service.reconcile("/store", []);

  assert.deepEqual(result.required, []);
  assert.deepEqual(result.initialized, []);
  assert.deepEqual(calls, [{ current: "store-project", ids: [] }]);
});
