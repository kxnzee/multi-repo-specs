/** @fileoverview Проверки fail-fast Plugin registry и repository lifecycle host. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PluginHost,
  PluginLoader,
  PluginRegistry,
} from "@openspec-orch/core";

/** Создаёт package contract для Loader с подменяемым plain Plugin export. */
async function loadPlugin(t, plugin) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-host-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = {
    name: `@test/openspec-orch-plugin-${plugin.id}`,
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  };
  await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(root, "index.js"), "export default {};\n");
  return new PluginLoader(async () => ({ default: plugin })).load({
    packageRoot: root,
    pluginId: plugin.id,
  });
}

/** Создаёт structurally valid Plugin export с наблюдаемым lifecycle. */
function pluginExport(id, calls, { repository = true, sync = true } = {}) {
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
    hasAgentContribution: () => false,
    integrateAgent() {},
    hasCommandContribution: () => false,
    registerCommands() {},
  });
}

test("PluginRegistry has stable order independent of load order and rejects duplicates", async (t) => {
  const calls = [];
  const beta = await loadPlugin(t, pluginExport("beta", calls));
  const alpha = await loadPlugin(t, pluginExport("alpha", calls));
  const registry = new PluginRegistry([beta, alpha]);

  assert.deepEqual(registry.list().map(({ id }) => id), ["alpha", "beta"]);
  assert.equal(registry.require("beta"), beta);
  assert.throws(() => registry.require("missing"), /PLUGIN_NOT_LOADED/);
  assert.throws(() => new PluginRegistry([alpha, alpha]), /не должны повторяться/);
});

test("PluginHost uses setup context for connect and connected context for status and sync", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPlugin(t, pluginExport("sample", calls));
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

  assert.equal(await host.connect(request), "connected");
  assert.deepEqual(await host.status(request), { state: "ready" });
  assert.equal(await host.sync(request), "synced");
  assert.deepEqual(contexts.map(([mode]) => mode), ["setup", "connected", "connected"]);
  assert.equal(new Set(calls.map(([, , context]) => context)).size, 3);
  assert.deepEqual(calls.map(([, operation]) => operation), ["connect", "status", "sync"]);
});

test("PluginHost fails before context creation or callback for unsupported lifecycle", async (t) => {
  const calls = [];
  const withoutRepository = await loadPlugin(t, pluginExport("commands", calls, {
    repository: false,
  }));
  const withoutSync = await loadPlugin(t, pluginExport("no-sync", calls, { sync: false }));
  let contextCalls = 0;
  const contextFactory = {
    async forRepositorySetup() { contextCalls += 1; },
    async forRepository() { contextCalls += 1; },
  };
  const host = new PluginHost({
    contextFactory,
    registry: new PluginRegistry([withoutRepository, withoutSync]),
  });

  await assert.rejects(host.connect({ pluginId: "commands" }), /PLUGIN_REPOSITORY_UNSUPPORTED/);
  await assert.rejects(host.sync({ pluginId: "no-sync" }), /PLUGIN_SYNC_UNSUPPORTED/);
  assert.equal(contextCalls, 0);
  assert.deepEqual(calls, []);
});
