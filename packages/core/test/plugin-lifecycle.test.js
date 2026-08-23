/** @fileoverview Проверки application service Plugin lifecycle и binding persistence. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configuration,
  createProject,
  PluginConnectionResult,
  PluginDisconnectionResult,
  PluginHost,
  PluginLifecycleService,
  PluginRegistry,
  PluginStatusResult,
} from "@openspec-orch/core";
import { loadPluginExport } from "./helpers/plugin-materializer.js";

/** Записывает project fixture с одним Store и одним Code Repository. */
async function createStoreFixture(t, { backendConnected = false, connected = false } = {}) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-lifecycle-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const storeRoot = path.join(workspaceRoot, "specs");
  await fs.mkdir(path.join(storeRoot, ".openspec-store"), { recursive: true });
  await fs.mkdir(path.join(storeRoot, "openspec"));
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [{ id: "sample", source: "@test/plugin-sample@1.0.0" }],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: [],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: connected ? ["sample"] : [],
      },
      {
        id: "backend",
        role: "code",
        remote: "https://example.test/backend.git",
        defaultBranch: "main",
        plugins: backendConnected ? ["sample"] : [],
      },
    ],
  });
  await fs.writeFile(
    path.join(storeRoot, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(
    path.join(storeRoot, "openspec-orch.yaml"),
    configuration.serializeProject(project),
  );
  await fs.writeFile(path.join(storeRoot, "openspec/config.yaml"), "schema: spec-driven\n");
  return { configPath: path.join(storeRoot, "openspec-orch.yaml"), storeRoot };
}

/** Загружает наблюдаемый Plugin через реальную package boundary Loader. */
async function loadPlugin(t, calls, { connect, status } = {}) {
  const plugin = Object.freeze({
    id: "sample",
    supports: Object.freeze(["code"]),
    supportsRole: (role) => role === "code",
    assertSupports(repository) {
      if (repository.role !== "code") throw new Error("unsupported");
    },
    hasRepositoryContribution: () => true,
    async connect(context) {
      calls.push(["connect", context]);
      return connect ? connect(context) : "connected";
    },
    async status(context) {
      calls.push(["status", context]);
      return status ? status(context) : { state: "ready" };
    },
    canSync: () => true,
    sync(context) {
      calls.push(["sync", context]);
      return "synced";
    },
    hasAgentContribution: () => false,
    integrateAgent() {},
    hasCommandContribution: () => false,
    registerCommands() {},
  });
  return loadPluginExport(t, plugin);
}

/** Собирает реальный Host и application service с наблюдаемыми contexts. */
async function lifecycle(t, calls, options = {}) {
  const loadedPlugin = await loadPlugin(t, calls, options);
  const contextCalls = [];
  const contextFactory = {
    async forRepositorySetup(request) {
      const context = Object.freeze({ mode: "setup", repositoryId: request.repositoryId });
      contextCalls.push(["setup", request, context]);
      return context;
    },
    async forRepository(request) {
      const context = Object.freeze({ mode: "connected", repositoryId: request.repositoryId });
      contextCalls.push(["connected", request, context]);
      return context;
    },
  };
  const host = new PluginHost({
    contextFactory,
    registry: new PluginRegistry([loadedPlugin]),
  });
  return { contextCalls, service: new PluginLifecycleService({ host }) };
}

test("PluginLifecycleService persists binding only after successful connect callback", async (t) => {
  const fixture = await createStoreFixture(t);
  const calls = [];
  let boundDuringCallback;
  const { contextCalls, service } = await lifecycle(t, calls, {
    connect: async () => {
      const current = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
      boundDuringCallback = current.isPluginConnected("sample", "frontend");
      return "configured";
    },
  });

  const result = await service.connect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  });

  assert.equal(result instanceof PluginConnectionResult, true);
  assert.equal(result.connected, true);
  assert.equal(result.output, "configured");
  assert.equal(result.pluginId, "sample");
  assert.equal(result.repositoryId, "frontend");
  assert.equal(boundDuringCallback, false);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), true);
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["setup"]);
  assert.deepEqual(calls.map(([operation]) => operation), ["connect"]);
});

test("PluginLifecycleService leaves config unchanged when connect callback fails", async (t) => {
  const fixture = await createStoreFixture(t);
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    connect: async () => { throw new Error("setup failed"); },
  });

  await assert.rejects(service.connect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  }), /setup failed/);

  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(calls.map(([operation]) => operation), ["connect"]);
  await assert.rejects(
    fs.lstat(path.join(
      fixture.storeRoot,
      ".openspec-orch/cache/locks/project-config.lock",
    )),
    { code: "ENOENT" },
  );
});

test("PluginLifecycleService keeps connect idempotent without repeating callback", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  const { contextCalls, service } = await lifecycle(t, calls);

  const result = await service.connect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  });

  assert.equal(result.connected, false);
  assert.equal(result.output, "");
  assert.deepEqual(contextCalls, []);
  assert.deepEqual(calls, []);
});

test("PluginLifecycleService disconnects idempotently without Plugin callback", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  const { contextCalls, service } = await lifecycle(t, calls);
  const request = {
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  };

  const disconnected = await service.disconnect(request);
  const repeated = await service.disconnect(request);

  assert.equal(disconnected instanceof PluginDisconnectionResult, true);
  assert.equal(disconnected.disconnected, true);
  assert.equal(disconnected.pluginId, "sample");
  assert.equal(disconnected.repositoryId, "frontend");
  assert.equal(repeated.disconnected, false);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), false);
  assert.deepEqual(contextCalls, []);
  assert.deepEqual(calls, []);
});

test("PluginLifecycleService delegates bound status and sync without changing config", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { contextCalls, service } = await lifecycle(t, calls);
  const request = {
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  };

  const status = await service.status(request);
  assert.equal(status instanceof PluginStatusResult, true);
  assert.deepEqual(status.toJSON(), {
    pluginId: "sample",
    repositoryId: "frontend",
    state: "ready",
    output: "",
  });
  assert.equal(await service.sync(request), "synced");
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["connected", "connected"]);
  assert.deepEqual(calls.map(([operation]) => operation), ["status", "sync"]);
});

test("PluginLifecycleService connects multiple repositories once under one project update", async (t) => {
  const fixture = await createStoreFixture(t);
  const calls = [];
  const { service } = await lifecycle(t, calls);

  const results = await service.connectMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryIds: ["backend", "frontend", "backend"],
  });

  assert.deepEqual(results.map(({ repositoryId }) => repositoryId), ["backend", "frontend"]);
  assert.deepEqual(results.map(({ connected }) => connected), [true, true]);
  assert.deepEqual(calls.map(([, context]) => context.repositoryId), ["backend", "frontend"]);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), true);
  assert.equal(persisted.isPluginConnected("sample", "backend"), true);
});

test("batch connect writes no bindings when a later callback fails", async (t) => {
  const fixture = await createStoreFixture(t);
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    connect: async (context) => {
      if (context.repositoryId === "backend") throw new Error("backend setup failed");
      return "configured";
    },
  });

  await assert.rejects(service.connectMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryIds: ["frontend", "backend"],
  }), /backend setup failed/);

  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(calls.map(([, context]) => context.repositoryId), ["frontend", "backend"]);
});

test("PluginLifecycleService reports statuses in project order and isolates failures", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    status: async (context) => {
      if (context.repositoryId === "backend") return Promise.reject("backend unavailable");
      return { state: "ready", details: "frontend ready" };
    },
  });

  const statuses = await service.statuses({ start: fixture.storeRoot });

  assert.deepEqual(statuses.map((status) => status.toJSON()), [
    {
      pluginId: "sample",
      repositoryId: "frontend",
      state: "ready",
      output: "frontend ready",
    },
    {
      pluginId: "sample",
      repositoryId: "backend",
      state: "unavailable",
      output: "backend unavailable",
    },
  ]);
});

test("Plugin binding lock fails closed without changing project config", async (t) => {
  const fixture = await createStoreFixture(t);
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { service } = await lifecycle(t, calls);
  const lockPath = path.join(
    fixture.storeRoot,
    ".openspec-orch/cache/locks/project-config.lock",
  );
  await fs.mkdir(lockPath, { recursive: true });

  await assert.rejects(service.connect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  }), /PLUGIN_BINDING_BUSY/);

  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(calls, []);
});
