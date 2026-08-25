/** @fileoverview Проверки fail-fast Plugin registry и repository lifecycle host. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PluginHost,
  PluginRegistry,
} from "@openspec-orch/core";
import { loadPluginExport } from "./helpers/plugin-materializer.js";

/** Создаёт structurally valid Plugin export с наблюдаемым lifecycle. */
function pluginExport(id, calls, { exec = true, repository = true, sync = true } = {}) {
  return Object.freeze({
    id,
    supports: Object.freeze(["code"]),
    supportsRole: (role) => role === "code",
    assertSupports() {},
    hasRepositoryContribution: () => repository,
    connect: (context) => {
      calls.push([id, "connect", context]);
      return "connected";
    },
    status: (context) => {
      calls.push([id, "status", context]);
      return { state: "ready" };
    },
    canSync: () => sync,
    sync: (context) => {
      calls.push([id, "sync", context]);
      return "synced";
    },
    canExec: () => exec,
    exec: (context, args) => {
      calls.push([id, "exec", context, args]);
      return "executed";
    },
    hasAgentContribution: () => false,
    integrateAgent() {},
    hasCommandContribution: () => false,
    registerCommands() {},
  });
}

test("PluginRegistry has stable order independent of load order and rejects duplicates", async (t) => {
  const calls = [];
  const beta = await loadPluginExport(t, pluginExport("beta", calls));
  const alpha = await loadPluginExport(t, pluginExport("alpha", calls));
  const registry = new PluginRegistry([beta, alpha]);

  assert.deepEqual(registry.list().map(({ id }) => id), ["alpha", "beta"]);
  assert.equal(registry.require("beta"), beta);
  assert.throws(() => registry.require("missing"), /PLUGIN_NOT_LOADED/);
  assert.throws(() => new PluginRegistry([alpha, alpha]), /не должны повторяться/);
});

test("PluginHost uses setup context for connect and connected context for bound operations", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPluginExport(t, pluginExport("sample", calls));
  const contexts = [];
  const contextFactory = {
    async forRepositorySetup(options) {
      const context = Object.freeze({ invocation: "setup", sequence: contexts.length });
      contexts.push(["setup", options, context]);
      return context;
    },
    async forRepository(options) {
      const context = Object.freeze({ invocation: "connected", sequence: contexts.length });
      contexts.push(["connected", options, context]);
      return context;
    },
  };
  const host = new PluginHost({
    contextFactory,
    registry: new PluginRegistry([loadedPlugin]),
  });
  const request = { pluginId: "sample", storeProject: {}, repositoryId: "frontend" };

  assert.equal(host.supportsRepository("sample", { id: "frontend", role: "code" }), true);
  assert.equal(host.supportsRepository("sample", { id: "specs", role: "store" }), false);
  assert.equal(await host.connect(request), "connected");
  assert.deepEqual(await host.status(request), { state: "ready" });
  assert.equal(await host.sync(request), "synced");
  const args = ["status", "--json"];
  assert.equal(await host.exec({ ...request, args }), "executed");
  args.push("--verbose");
  assert.deepEqual(
    contexts.map(([mode]) => mode),
    ["setup", "connected", "connected", "connected"],
  );
  assert.equal(new Set(calls.map(([, , context]) => context)).size, 4);
  assert.deepEqual(
    calls.map(([, operation]) => operation),
    ["connect", "status", "sync", "exec"],
  );
  assert.deepEqual(calls[3][3], ["status", "--json"]);
  assert.equal(Object.isFrozen(calls[3][3]), true);
});

test("PluginHost fails before context creation or callback for unsupported lifecycle", async (t) => {
  const calls = [];
  const withoutRepository = await loadPluginExport(t, pluginExport("commands", calls, {
    repository: false,
  }));
  const withoutSync = await loadPluginExport(t, pluginExport("no-sync", calls, { sync: false }));
  const withoutExec = await loadPluginExport(t, pluginExport("no-exec", calls, { exec: false }));
  let contextCalls = 0;
  const contextFactory = {
    async forRepositorySetup() { contextCalls += 1; },
    async forRepository() { contextCalls += 1; },
  };
  const host = new PluginHost({
    contextFactory,
    registry: new PluginRegistry([withoutExec, withoutRepository, withoutSync]),
  });

  await assert.rejects(host.connect({ pluginId: "commands" }), /PLUGIN_REPOSITORY_UNSUPPORTED/);
  await assert.rejects(host.sync({ pluginId: "no-sync" }), /PLUGIN_SYNC_UNSUPPORTED/);
  await assert.rejects(host.exec({ pluginId: "no-exec", args: ["status"] }), /PLUGIN_EXEC_UNSUPPORTED/);
  assert.equal(contextCalls, 0);
  assert.deepEqual(calls, []);
});
