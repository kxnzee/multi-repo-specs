/** @fileoverview Проверки fail-fast Plugin registry и repository lifecycle host. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { definePlugin } from "@openspec-orch/plugin-sdk";
import {
  PluginHost,
  PluginRegistry,
} from "@openspec-orch/core";
import { loadPluginExport } from "./helpers/plugin-materializer.js";
import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Создаёт structurally valid Plugin export с наблюдаемым lifecycle. */
function pluginExport(
  id,
  calls,
  { exec = true, extensions = false, repository = true, sync = true } = {},
) {
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
    hasExtensionContribution: () => extensions,
    extensions: (context) => {
      calls.push([id, "extensions", context]);
      return Object.freeze([Object.freeze({
        id: "agent",
        root: "./extension",
        target: context.repository,
      })]);
    },
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

test("PluginHost forwards Extension contribution to Agent Adapter after connect", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPluginExport(t, pluginExport("sample", calls, {
    extensions: true,
  }));
  await fs.mkdir(path.join(loadedPlugin.root, "extension"));
  const context = Object.freeze({
    agent: Object.freeze({ id: "qwen" }),
    repository: Object.freeze({ id: "frontend", role: "code" }),
  });
  const adapterCalls = [];
  const host = new PluginHost({
    agentAdapter: {
      async validateExtension(extension, options) {
        adapterCalls.push(["validate", extension, options]);
      },
      async invokeExtension(receivedContext, extension, request) {
        adapterCalls.push([receivedContext, extension, request]);
      },
    },
    contextFactory: {
      async forRepositorySetup() { return context; },
      async forRepository() { throw new Error("unexpected connected context"); },
    },
    registry: new PluginRegistry([loadedPlugin]),
  });

  assert.equal(await host.connect({
    pluginId: "sample",
    repositoryId: "frontend",
    storeProject: {},
  }), "connected");

  assert.deepEqual(calls.map(([, operation]) => operation), ["extensions", "connect"]);
  assert.equal(adapterCalls.length, 2);
  assert.deepEqual(adapterCalls[0], [
    "validate",
    {
      id: "agent",
      root: path.join(loadedPlugin.root, "extension"),
      target: { id: "frontend", role: "code" },
    },
    { ownerId: "sample" },
  ]);
  assert.equal(adapterCalls[1][0], context);
  assert.deepEqual(adapterCalls[1][1], {
    id: "agent",
    root: path.join(loadedPlugin.root, "extension"),
    target: { id: "frontend", role: "code" },
  });
  assert.deepEqual(adapterCalls[1][2], { operation: "connect", ownerId: "sample" });
  assert.equal(Object.isFrozen(adapterCalls[1][2]), true);
});

test("PluginHost checks Extension through Agent Adapter after Plugin status", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPluginExport(t, pluginExport("sample", calls, {
    extensions: true,
  }));
  await fs.mkdir(path.join(loadedPlugin.root, "extension"));
  const context = Object.freeze({
    agent: Object.freeze({ id: "qwen" }),
    repository: Object.freeze({ id: "frontend", role: "code" }),
  });
  const operations = [];
  const host = new PluginHost({
    agentAdapter: {
      async validateExtension() {},
      async invokeExtension(receivedContext, extension, request) {
        assert.equal(receivedContext, context);
        assert.equal(extension.id, "agent");
        operations.push(request.operation);
      },
    },
    contextFactory: {
      async forRepositorySetup() { throw new Error("unexpected setup context"); },
      async forRepository() { return context; },
    },
    registry: new PluginRegistry([loadedPlugin]),
  });

  assert.deepEqual(await host.status({
    pluginId: "sample",
    repositoryId: "frontend",
    storeProject: {},
  }), { state: "ready" });
  assert.deepEqual(calls.map(([, operation]) => operation), ["status", "extensions"]);
  assert.deepEqual(operations, ["status"]);
});

test("PluginHost rejects a Plugin Extension root symlink before Agent invocation", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPluginExport(t, pluginExport("sample", calls, {
    extensions: true,
  }));
  const external = path.join(path.dirname(loadedPlugin.root), "external-extension");
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.mkdir(external);
  await createDirectoryLink(external, path.join(loadedPlugin.root, "extension"));
  const adapterCalls = [];
  const context = Object.freeze({
    agent: Object.freeze({ id: "qwen" }),
    repository: Object.freeze({ id: "frontend", role: "code" }),
  });
  const host = new PluginHost({
    agentAdapter: {
      async validateExtension() { adapterCalls.push("validate"); },
      async invokeExtension() { adapterCalls.push("invoke"); },
    },
    contextFactory: {
      async forRepositorySetup() { return context; },
      async forRepository() { return context; },
    },
    registry: new PluginRegistry([loadedPlugin]),
  });

  await assert.rejects(
    host.connect({ pluginId: "sample", repositoryId: "frontend", storeProject: {} }),
    /PLUGIN_EXTENSION_INVALID.*symlink/u,
  );
  assert.deepEqual(adapterCalls, []);
  assert.deepEqual(calls.map(([, operation]) => operation), ["extensions"]);
});

test("PluginHost validates every Extension before Plugin connect and native mutation", async (t) => {
  const calls = [];
  const loadedPlugin = await loadPluginExport(t, definePlugin({
    id: "sample",
    supports: ["code"],
    extensions(context) {
      calls.push("extensions");
      return [
        { id: "first", root: "./extension", target: context.repository },
        { id: "second", root: "./extension", target: context.repository },
      ];
    },
    repository: {
      connect() { calls.push("connect"); },
      status() { return { state: "ready" }; },
    },
  }));
  await fs.mkdir(path.join(loadedPlugin.root, "extension"));
  const context = Object.freeze({
    agent: Object.freeze({ id: "qwen" }),
    repository: Object.freeze({ id: "frontend", role: "code" }),
  });
  const host = new PluginHost({
    agentAdapter: {
      async validateExtension(extension) {
        calls.push(`validate:${extension.id}`);
        if (extension.id === "second") throw new Error("invalid second manifest");
      },
      async invokeExtension() { calls.push("native"); },
    },
    contextFactory: {
      async forRepositorySetup() { return context; },
      async forRepository() { return context; },
    },
    registry: new PluginRegistry([loadedPlugin]),
  });

  await assert.rejects(
    host.connect({ pluginId: "sample", repositoryId: "frontend", storeProject: {} }),
    /invalid second manifest/u,
  );
  assert.deepEqual(calls, ["extensions", "validate:first", "validate:second"]);
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
