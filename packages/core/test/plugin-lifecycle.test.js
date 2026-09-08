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
  OpenSpecPointerService,
  StoreProjectService,
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
    version: 1,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: ["sample"],
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
async function loadPlugin(t, calls, { connect, exec, extensions = false, status } = {}) {
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
    canExec: () => true,
    exec(context, args) {
      calls.push(["exec", context, args]);
      return exec ? exec(context, args) : "executed";
    },
    hasExtensionContribution: () => extensions,
    extensions(context) {
      calls.push(["extensions", context]);
      return Object.freeze([Object.freeze({
        id: "agent",
        root: "./extension",
        target: Object.freeze({ id: context.repositoryId, role: "code" }),
      })]);
    },
    hasCommandContribution: () => false,
    registerCommands() {},
  });
  return loadPluginExport(t, plugin);
}

/** Собирает реальный Host и application service с наблюдаемыми contexts. */
async function lifecycle(t, calls, options = {}) {
  const { agentAdapter, initiallyLoaded = true, storeProjectService, ...pluginOptions } = options;
  const loadedPlugin = await loadPlugin(t, calls, pluginOptions);
  if (pluginOptions.extensions) await fs.mkdir(path.join(loadedPlugin.root, "extension"));
  const contextCalls = [];
  const contextFactory = {
    async forRepositorySetup(request) {
      const context = Object.freeze({
        mode: "setup",
        repositoryId: request.repositoryId,
        repository: Object.freeze({ id: request.repositoryId, role: "code" }),
      });
      contextCalls.push(["setup", request, context]);
      return context;
    },
    async forRepository(request) {
      const context = Object.freeze({
        mode: "connected",
        repositoryId: request.repositoryId,
        repository: Object.freeze({ id: request.repositoryId, role: "code" }),
      });
      contextCalls.push(["connected", request, context]);
      return context;
    },
  };
  const host = new PluginHost({
    agentAdapter: agentAdapter && Object.freeze({
      validateExtension: agentAdapter.validateExtension ?? (async () => {}),
      invokeExtension: agentAdapter.invokeExtension,
    }),
    contextFactory,
    registry: new PluginRegistry(initiallyLoaded ? [loadedPlugin] : []),
  });
  const managerCalls = [];
  const managerService = {
    forStore() {
      return {
        async resolve(declaration) {
          managerCalls.push(declaration.id);
          return { loadedPlugin };
        },
      };
    },
  };
  return {
    contextCalls,
    managerCalls,
    service: new PluginLifecycleService({ host, managerService, storeProjectService }),
  };
}

test("PluginLifecycleService disconnects Extension before removing binding", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  let boundDuringExtensionDisconnect;
  const { service } = await lifecycle(t, calls, {
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, extension, request) {
        const current = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
        boundDuringExtensionDisconnect = current.isPluginConnected("sample", "frontend");
        calls.push(["agent-extension", context, extension, request]);
      },
    },
  });

  const result = await service.disconnect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  });

  assert.equal(result.disconnected, true);
  assert.equal(boundDuringExtensionDisconnect, true);
  assert.deepEqual(calls.map(([operation]) => operation), ["extensions", "agent-extension"]);
  assert.deepEqual(calls[1][3], { operation: "disconnect", ownerId: "sample" });
  assert.equal(Object.isFrozen(calls[1][3]), true);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), false);
});

test("PluginLifecycleService restores sibling Extensions after partial disconnect", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, extension, request) {
        const current = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
        calls.push([
          "agent-extension",
          context.repositoryId,
          request,
          current.isPluginConnected("sample", "frontend"),
          current.isPluginConnected("sample", "backend"),
        ]);
      },
    },
  });

  const result = await service.disconnect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  });

  assert.equal(result.disconnected, true);
  assert.deepEqual(calls.filter(([operation]) => operation === "agent-extension"), [
    [
      "agent-extension",
      "frontend",
      { operation: "disconnect", ownerId: "sample" },
      true,
      true,
    ],
    [
      "agent-extension",
      "backend",
      { operation: "connect", ownerId: "sample" },
      false,
      true,
    ],
  ]);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), false);
  assert.equal(persisted.isPluginConnected("sample", "backend"), true);
});

test("PluginLifecycleService reconnects Extension for an existing portable binding", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  const { contextCalls, service } = await lifecycle(t, calls, {
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, extension, request) {
        calls.push(["agent-extension", context, extension, request]);
      },
    },
  });

  const result = await service.connect({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryId: "frontend",
  });

  assert.equal(result.connected, false);
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["connected"]);
  assert.deepEqual(calls.map(([operation]) => operation), ["extensions", "agent-extension"]);
  assert.deepEqual(calls[1][3], { operation: "connect", ownerId: "sample" });
});

test("PluginLifecycleService restores every portable Extension contribution without changing bindings", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { contextCalls, service } = await lifecycle(t, calls, {
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, extension, request) {
        calls.push(["agent-extension", context, extension, request]);
      },
    },
  });

  const restored = await service.connectSelected({ start: fixture.storeRoot });

  assert.deepEqual(restored, [
    { pluginId: "sample", repositoryId: "frontend" },
    { pluginId: "sample", repositoryId: "backend" },
  ]);
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["setup", "setup"]);
  assert.deepEqual(calls.map(([operation]) => operation), [
    "extensions", "connect", "agent-extension",
    "extensions", "connect", "agent-extension",
  ]);
  assert.deepEqual(calls.filter(([operation]) => operation === "agent-extension")
    .map(([, , , request]) => request), [
    { operation: "connect", ownerId: "sample" },
    { operation: "connect", ownerId: "sample" },
  ]);
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);

  calls.length = 0;
  contextCalls.length = 0;
  const statuses = await service.statusSelected({ start: fixture.storeRoot });
  assert.deepEqual(statuses.map((status) => status.toJSON()), [
    { pluginId: "sample", repositoryId: "frontend", state: "ready", output: "" },
    { pluginId: "sample", repositoryId: "backend", state: "ready", output: "" },
  ]);
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["connected", "connected"]);
  assert.deepEqual(calls.filter(([operation]) => operation === "agent-extension")
    .map(([, , , request]) => request), [
    { operation: "status", ownerId: "sample" },
    { operation: "status", ownerId: "sample" },
  ]);
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);

  calls.length = 0;
  contextCalls.length = 0;
  const disconnected = await service.disconnectSelected({ start: fixture.storeRoot });
  assert.deepEqual(disconnected, [...restored].reverse());
  assert.deepEqual(contextCalls.map(([mode]) => mode), ["connected", "connected"]);
  assert.deepEqual(calls.filter(([operation]) => operation === "agent-extension")
    .map(([, , , request]) => request), [
    { operation: "disconnect", ownerId: "sample" },
    { operation: "disconnect", ownerId: "sample" },
  ]);
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
});

test("PluginLifecycleService reloads a declared Plugin after package runtime restoration", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  const { managerCalls, service } = await lifecycle(t, calls, { initiallyLoaded: false });

  const restored = await service.connectSelected({ start: fixture.storeRoot });

  assert.deepEqual(restored, [{ pluginId: "sample", repositoryId: "frontend" }]);
  assert.deepEqual(managerCalls, ["sample"]);
  assert.deepEqual(calls.map(([operation]) => operation), ["connect"]);
});

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

test("PluginLifecycleService delegates bound status, sync and exec without changing config", async (t) => {
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
  assert.equal(await service.exec({ ...request, args: ["status", "--json"] }), "executed");
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(
    contextCalls.map(([mode]) => mode),
    ["connected", "connected", "connected"],
  );
  assert.deepEqual(calls.map(([operation]) => operation), ["status", "sync", "exec"]);
  assert.deepEqual(calls[2][2], ["status", "--json"]);
});

test("PluginLifecycleService runs sync and exec for every connected binding in project order", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    exec: (context, args) => `${context.repositoryId}:${args.join(" ")}`,
  });

  const syncResults = await service.syncMany({
    start: fixture.storeRoot,
    pluginId: "sample",
  });
  const execResults = await service.execMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    args: ["status", "--json"],
  });

  assert.deepEqual(syncResults, [
    { pluginId: "sample", repositoryId: "frontend", output: "synced" },
    { pluginId: "sample", repositoryId: "backend", output: "synced" },
  ]);
  assert.deepEqual(execResults, [
    { pluginId: "sample", repositoryId: "frontend", output: "frontend:status --json" },
    { pluginId: "sample", repositoryId: "backend", output: "backend:status --json" },
  ]);
  assert.deepEqual(
    calls.filter(([operation]) => operation === "exec").map(([, context, args]) => (
      [context.repositoryId, args]
    )),
    [
      ["frontend", ["status", "--json"]],
      ["backend", ["status", "--json"]],
    ],
  );
});

test("PluginLifecycleService selects supported connect targets and connected operation targets", async (t) => {
  const fixture = await createStoreFixture(t, { connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls);

  assert.deepEqual(await service.repositoryCandidates({
    start: fixture.storeRoot,
    pluginId: "sample",
    operation: "connect",
  }), [
    { id: "frontend", role: "code" },
    { id: "backend", role: "code" },
  ]);
  assert.deepEqual(await service.repositoryCandidates({
    start: fixture.storeRoot,
    pluginId: "sample",
    operation: "sync",
  }), [
    { id: "frontend", role: "code" },
  ]);
});

test("PluginLifecycleService limits sync and exec batches to explicit repository IDs", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    exec: (context, args) => `${context.repositoryId}:${args.join(" ")}`,
  });

  const syncResults = await service.syncMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryIds: ["backend"],
  });
  const execResults = await service.execMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryIds: ["backend"],
    args: ["status"],
  });

  assert.deepEqual(syncResults.map(({ repositoryId }) => repositoryId), ["backend"]);
  assert.deepEqual(execResults.map(({ repositoryId }) => repositoryId), ["backend"]);
  assert.deepEqual(calls.map(([operation, context]) => [operation, context.repositoryId]), [
    ["sync", "backend"],
    ["exec", "backend"],
  ]);
});

test("PluginLifecycleService disconnects every connected binding when repository IDs are omitted", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const calls = [];
  const { service } = await lifecycle(t, calls);

  const results = await service.disconnectMany({
    start: fixture.storeRoot,
    pluginId: "sample",
  });

  assert.deepEqual(results.map(({ repositoryId, disconnected }) => ({
    repositoryId,
    disconnected,
  })), [
    { repositoryId: "frontend", disconnected: true },
    { repositoryId: "backend", disconnected: true },
  ]);
  const persisted = configuration.parseProject(await fs.readFile(fixture.configPath, "utf8"));
  assert.equal(persisted.isPluginConnected("sample", "frontend"), false);
  assert.equal(persisted.isPluginConnected("sample", "backend"), false);
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
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, _extension, request) {
        calls.push([`agent-${request.operation}`, context]);
      },
    },
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
  assert.deepEqual(calls.map(([operation, context]) => [operation, context.repositoryId]), [
    ["extensions", "frontend"],
    ["connect", "frontend"],
    ["agent-connect", "frontend"],
    ["extensions", "backend"],
    ["connect", "backend"],
    ["extensions", "frontend"],
    ["agent-disconnect", "frontend"],
  ]);
});

test("batch disconnect restores earlier Extensions when a later cleanup fails", async (t) => {
  const fixture = await createStoreFixture(t, { backendConnected: true, connected: true });
  const before = await fs.readFile(fixture.configPath, "utf8");
  const calls = [];
  const { service } = await lifecycle(t, calls, {
    extensions: true,
    agentAdapter: {
      async invokeExtension(context, _extension, request) {
        calls.push([`agent-${request.operation}`, context.repositoryId]);
        if (request.operation === "disconnect" && context.repositoryId === "backend") {
          throw new Error("backend cleanup failed");
        }
      },
    },
  });

  await assert.rejects(service.disconnectMany({
    start: fixture.storeRoot,
    pluginId: "sample",
    repositoryIds: ["frontend", "backend"],
  }), /backend cleanup failed/u);

  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.deepEqual(calls.filter(([operation]) => operation.startsWith("agent-")), [
    ["agent-disconnect", "frontend"],
    ["agent-disconnect", "backend"],
    ["agent-connect", "frontend"],
  ]);
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

/** Resolves a real config-only pointer through a controlled OpenSpec process response. */
async function pointerLifecycle(t, calls, { responseStoreId = "specs" } = {}) {
  const fixture = await createStoreFixture(t, { connected: true });
  const repositoryRoot = path.join(path.dirname(fixture.storeRoot), "frontend");
  const start = path.join(repositoryRoot, "src");
  await fs.mkdir(start, { recursive: true });
  await fs.mkdir(path.join(repositoryRoot, "openspec"));
  await fs.writeFile(path.join(repositoryRoot, "openspec/config.yaml"), "store: specs\n");
  const pointerCalls = [];
  const storeRoot = await fs.realpath(fixture.storeRoot);
  const storeProjectService = new StoreProjectService(configuration, new OpenSpecPointerService(
    undefined,
    async (executable, args, options) => {
      pointerCalls.push({ executable, args, cwd: options.cwd });
      return { failed: false, stderr: "", stdout: JSON.stringify({
        root: { path: storeRoot, source: "declared", store_id: responseStoreId },
      }) };
    },
  ));
  return { ...fixture, start, pointerCalls, repositoryRoot: await fs.realpath(repositoryRoot),
    ...await lifecycle(t, calls, { storeProjectService }) };
}

test("Plugin lifecycle resolves Code Repository pointers for direct and batch operations", async (t) => {
  const calls = [];
  const fixture = await pointerLifecycle(t, calls);
  const { service, start } = fixture;
  const before = await fs.readFile(fixture.configPath, "utf8");
  const request = { start, pluginId: "sample", repositoryId: "frontend" };
  assert.equal((await service.status(request)).toJSON().state, "ready");
  assert.equal(await service.sync(request), "synced");
  assert.equal(await service.exec({ ...request, args: ["inspect"] }), "executed");
  const batch = { start, pluginId: "sample", repositoryIds: ["frontend"] };
  assert.equal((await service.syncMany(batch))[0].output, "synced");
  assert.equal((await service.execMany({ ...batch, args: ["inspect"] }))[0].output, "executed");
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
  assert.equal(fixture.pointerCalls.length, 5);
  for (const call of fixture.pointerCalls) {
    assert.deepEqual(call, { executable: "openspec", args: ["context", "--json"],
      cwd: fixture.repositoryRoot });
  }
  assert.deepEqual(calls.map(([operation]) => operation), ["status", "sync", "exec", "sync", "exec"]);
});

test("Plugin lifecycle rejects an unresolved pointer before executing or mutating", async (t) => {
  const calls = [];
  const fixture = await pointerLifecycle(t, calls, { responseStoreId: "other" });
  const before = await fs.readFile(fixture.configPath, "utf8");
  for (const operation of ["execMany", "connectMany", "disconnectMany"]) {
    await assert.rejects(fixture.service[operation]({
      start: fixture.start, pluginId: "sample", repositoryIds: ["frontend"], args: ["inspect"],
    }), /pointer не разрешён/);
  }
  assert.deepEqual(calls, []);
  assert.equal(await fs.readFile(fixture.configPath, "utf8"), before);
});
