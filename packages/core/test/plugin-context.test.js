/** @fileoverview Проверки immutable repository-scoped PluginContext. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createProject,
  createStore,
  FileService,
  GitService,
  OpenSpecService,
  PluginContext,
  PluginContextFactory,
  PluginLoader,
  PluginStorageService,
  ProcessService,
  StoreProject,
  WorkspaceResolver,
} from "@openspec-orch/core";

const SAMPLE_ROOT = await fs.realpath(fileURLToPath(
  new URL("../../../test-fixtures/plugin-sdk/sample-plugin/", import.meta.url),
));

/** Собирает Project с одним связанным и одним несвязанным Code Repository. */
async function contextScenario(t, { backendPlugin = false, storePlugin = false } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-plugin-context-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storeRoot = path.join(root, "specs");
  const frontendRoot = path.join(root, "src/frontend");
  const backendRoot = path.join(root, "src/backend");
  await fs.mkdir(storeRoot);
  await fs.mkdir(frontendRoot, { recursive: true });
  const project = createProject({
    version: 2,
    strict: true,
    template: { id: "base" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [{ id: "sample", source: "@test/plugin-sample@1.0.0" }],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: storePlugin ? ["sample"] : [],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: ["sample"],
      },
      {
        id: "backend",
        role: "code",
        remote: "https://example.test/backend.git",
        defaultBranch: "main",
        plugins: backendPlugin ? ["sample"] : [],
      },
    ],
  });
  const store = createStore({ id: "specs", remote: "https://example.test/specs.git" });
  const storeProject = new StoreProject({ root: storeRoot, store, project });
  const loadedPlugin = await new PluginLoader().load({
    packageRoot: SAMPLE_ROOT,
    pluginId: "sample",
  });
  return { backendRoot, frontendRoot, loadedPlugin, storeProject };
}

/** Создаёт context factory с одним проверяемым process boundary. */
function contextFactory(calls, log) {
  const processService = new ProcessService(async (executable, args, options) => {
    calls.push({ executable, args, options });
    const stdout = executable === "git"
      ? (args[0] === "status" ? "" : args[0] === "rev-parse" ? "a".repeat(40) : "main")
      : executable === "openspec" ? "1.7.0" : "done";
    return { failed: false, stderr: "", stdout };
  });
  return new PluginContextFactory({
    fileService: new FileService(),
    gitService: new GitService(processService),
    logSink: log,
    openSpecService: new OpenSpecService(processService),
    processService,
    storageService: new PluginStorageService(),
    workspaceService: new WorkspaceResolver(),
  });
}

test("PluginContextFactory creates a new immutable scoped context without exposing roots", async (t) => {
  const scenario = await contextScenario(t);
  const calls = [];
  const messages = [];
  const log = {
    info: (message) => messages.push(["info", message]),
    warn: (message) => messages.push(["warn", message]),
    error: (message) => messages.push(["error", message]),
  };
  const factory = contextFactory(calls, log);
  const context = await factory.forRepository({
    loadedPlugin: scenario.loadedPlugin,
    storeProject: scenario.storeProject,
    repositoryId: "frontend",
  });
  const second = await factory.forRepository({
    loadedPlugin: scenario.loadedPlugin,
    storeProject: scenario.storeProject,
    repositoryId: "frontend",
  });

  assert.equal(context instanceof PluginContext, true);
  assert.notEqual(context, second);
  assert.equal(Object.isFrozen(context), true);
  assert.deepEqual(context.project, {
    id: "specs",
    strict: true,
    store: { id: "specs", role: "store" },
    repositories: [
      { id: "specs", role: "store" },
      { id: "frontend", role: "code" },
      { id: "backend", role: "code" },
    ],
    agent: { id: "qwen" },
  });
  assert.deepEqual(context.repository, { id: "frontend", role: "code" });
  assert.equal("root" in context.repository, false);
  assert.equal("root" in context.files, false);
  assert.equal("cwd" in context.process, false);
  assert.deepEqual(context.repositories.list(), context.project.repositories);
  assert.deepEqual(context.repositories.requireConnected(["frontend"]), [context.repository]);
  assert.throws(
    () => context.repositories.requireConnected(["backend"]),
    /PLUGIN_NOT_CONNECTED/,
  );
  const frontendGit = await context.repositories.git("frontend");
  assert.equal(await frontendGit.revision(), "a".repeat(40));
  assert.equal(await frontendGit.hasCommit("a".repeat(40)), true);
  await assert.rejects(context.repositories.git("backend"), /PLUGIN_NOT_CONNECTED/);

  await context.files.write("plugin.txt", "safe\n");
  assert.equal(await context.files.read("plugin.txt"), "safe\n");
  assert.equal(await context.git.revision(), "a".repeat(40));
  assert.equal(await context.openspec.version(), "1.7.0");
  assert.equal(await context.process.run("plugin-tool", ["status"]), "done");
  assert.equal(calls.at(-1).options.cwd, scenario.frontendRoot);
  await context.storage.write({ ready: true });
  assert.deepEqual(await context.storage.read(), { ready: true });
  context.logger.info("ready");
  assert.deepEqual(messages, [["info", "[plugin:sample][repository:frontend] ready"]]);
});

test("PluginContextFactory creates Store context for Store-scoped setup", async (t) => {
  const scenario = await contextScenario(t);
  const factory = contextFactory([], { info() {}, warn() {}, error() {} });

  const context = await factory.forStoreSetup({
    loadedPlugin: scenario.loadedPlugin,
    storeProject: scenario.storeProject,
  });

  assert.deepEqual(context.repository, { id: "specs", role: "store" });
  assert.equal(context.agent.id, "qwen");
});

test("PluginContextFactory rejects bindings before resolving an unavailable checkout", async (t) => {
  const scenario = await contextScenario(t);
  const factory = contextFactory([], { info() {}, warn() {}, error() {} });

  await assert.rejects(
    factory.forRepository({
      loadedPlugin: scenario.loadedPlugin,
      storeProject: scenario.storeProject,
      repositoryId: "backend",
    }),
    /PLUGIN_NOT_CONNECTED: sample не подключён к backend/,
  );
  await assert.rejects(
    factory.forRepositorySetup({
      loadedPlugin: scenario.loadedPlugin,
      storeProject: scenario.storeProject,
      repositoryId: "backend",
    }),
    /REPOSITORY_CHECKOUT_UNAVAILABLE/,
  );

  await fs.mkdir(scenario.backendRoot);
  const setup = await factory.forRepositorySetup({
    loadedPlugin: scenario.loadedPlugin,
    storeProject: scenario.storeProject,
    repositoryId: "backend",
  });
  assert.deepEqual(setup.repository, { id: "backend", role: "code" });
  await assert.rejects(
    factory.forRepository({
      loadedPlugin: scenario.loadedPlugin,
      storeProject: scenario.storeProject,
      repositoryId: "backend",
    }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("Plugin repository Git returns null only for a connected missing checkout", async (t) => {
  const scenario = await contextScenario(t, { backendPlugin: true });
  const factory = contextFactory([], { info() {}, warn() {}, error() {} });
  const context = await factory.forRepository({
    loadedPlugin: scenario.loadedPlugin,
    storeProject: scenario.storeProject,
    repositoryId: "frontend",
  });

  assert.equal(await context.repositories.git("backend"), null);
});

test("PluginContextFactory rejects unsupported bound roles before Plugin callback", async (t) => {
  const scenario = await contextScenario(t, { storePlugin: true });
  const factory = contextFactory([], { info() {}, warn() {}, error() {} });

  await assert.rejects(
    factory.forRepository({
      loadedPlugin: scenario.loadedPlugin,
      storeProject: scenario.storeProject,
      repositoryId: "specs",
    }),
    /PLUGIN_SCOPE_UNSUPPORTED: sample не поддерживает role store/,
  );
  assert.throws(() => new PluginContext({}), /PLUGIN_CONTEXT_INVALID/);
});
