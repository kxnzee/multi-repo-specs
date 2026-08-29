/** @fileoverview Проверка полного wiring Plugin Platform через candidate CLI. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { definePlugin } from "@openspec-orch/plugin-sdk";
import {
  BundledPluginPackage,
  BundledPluginProvider,
  configuration,
  createCandidateProgram,
  createProject,
} from "@openspec-orch/core";

import { loadPluginExport, SAMPLE_PLUGIN_ROOT } from "./helpers/plugin-materializer.js";

/** Создаёт реальный Store config для candidate lifecycle flow. */
async function storeFixture(t, { declared = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-platform-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
  const project = createProject({
    version: 2,
    strict: true,
    template: { id: "base" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: declared ? [{ id: "sample", source: "@test/plugin-sample@1.0.0" }] : [],
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
        plugins: [],
      },
    ],
  });
  await fs.writeFile(
    path.join(root, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(path.join(root, "openspec-orch.yaml"), configuration.serializeProject(project));
  await fs.writeFile(path.join(root, "openspec/config.yaml"), "schema: spec-driven\n");
  return root;
}

/** Загружает наблюдаемый sample Plugin через настоящий Loader. */
async function samplePlugin(t, calls) {
  const plugin = definePlugin({
    id: "sample",
    supports: ["code"],
    repository: {
      connect(context) {
        calls.push(["connect", context.repositoryId]);
        return "configured";
      },
      status(context) {
        calls.push(["status", context.repositoryId]);
        return { state: "ready", details: "indexed" };
      },
      sync(context) {
        calls.push(["sync", context.repositoryId]);
        return "updated";
      },
      exec(context, args) {
        calls.push(["exec", context.repositoryId, args]);
        return "native output";
      },
    },
    registerCommands(commands) {
      commands.command("hello")
        .description("Hello")
        .action(() => calls.push(["command", "hello"]));
    },
  });
  return loadPluginExport(t, plugin);
}

test("PluginPlatform wires sample lifecycle and namespaced command into candidate CLI", async (t) => {
  const storeRoot = await storeFixture(t);
  const calls = [];
  const loadedPlugin = await samplePlugin(t, calls);
  const output = [];
  const options = {
    loadedPlugins: [loadedPlugin],
    pluginCommandOptions: { output: { log: (value) => output.push(value) } },
    pluginContextFactory: {
      async forRepositorySetup({ repositoryId }) {
        return Object.freeze({ repositoryId });
      },
      async forRepository({ repositoryId }) {
        return Object.freeze({ repositoryId });
      },
    },
  };
  const previousCwd = process.cwd();
  process.chdir(storeRoot);
  try {
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "connect",
      "sample",
      "--repo",
      "frontend",
    ]);
    output.length = 0;
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "status",
      "--plugin",
      "sample",
      "--repo",
      "frontend",
      "--json",
    ]);
    assert.deepEqual(JSON.parse(output[0]), {
      plugins: [{
        pluginId: "sample",
        repositoryId: "frontend",
        state: "ready",
        output: "indexed",
      }],
    });
    output.length = 0;
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "sync",
      "sample",
      "--repo",
      "frontend",
    ]);
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "exec",
      "sample",
      "--repo",
      "frontend",
      "--",
      "native-status",
      "--json",
    ]);
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "sample",
      "hello",
    ]);
  } finally {
    process.chdir(previousCwd);
  }

  const persisted = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.equal(persisted.isPluginConnected("sample", "frontend"), true);
  assert.deepEqual(calls, [
    ["connect", "frontend"],
    ["status", "frontend"],
    ["status", "frontend"],
    ["sync", "frontend"],
    ["status", "frontend"],
    ["exec", "frontend", ["native-status", "--json"]],
    ["command", "hello"],
  ]);
  assert.deepEqual(output, [
    "✓ sample → frontend — синхронизирован",
    "updated",
    "✓ sample → frontend — готов",
    "  indexed",
    "native output",
  ]);
});

test("empty composition still exposes Core plugin lifecycle without Plugin-specific branches", async () => {
  const program = await createCandidateProgram({ loadedPlugins: [] });
  assert.equal(program.commands.some((command) => command.name() === "plugin"), true);
  assert.equal(program.commands.some((command) => command.name() === "extensions"), false);
  assert.equal(program.commands.some((command) => command.name() === "sample"), false);
  await assert.rejects(
    createCandidateProgram({
      loadedPlugins: [],
      pluginCommandOptions: { applicationService: {} },
    }),
    /applicationService управляется PluginPlatform/,
  );
});

test("automatic composition tolerates a missing Store through the injected resolver", async () => {
  const start = "/virtual/without-store";
  const calls = [];
  const program = await createCandidateProgram({
    pluginManagerService: {
      forStore() {
        assert.fail("manager must not be requested without a Store");
      },
    },
    start,
    storeProjectService: {
      async resolve(received) {
        calls.push(received);
        throw Object.assign(new Error("Store not found"), { code: "STORE_ROOT_NOT_FOUND" });
      },
    },
  });

  assert.deepEqual(calls, [start]);
  assert.equal(program.commands.some((command) => command.name() === "plugin"), true);
  assert.equal(program.commands.some((command) => command.name() === "sample"), false);
});

test("Doctor reports an invalid Store even when automatic Plugin composition cannot start", async (t) => {
  const start = "/virtual/invalid-store";
  const output = [];
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  t.mock.method(console, "log", (value) => output.push(value));
  const program = await createCandidateProgram({
    pluginManagerService: {
      forStore() {
        assert.fail("manager must not be requested for an invalid Store");
      },
    },
    start,
    storeProjectService: {
      async resolve() {
        throw Object.assign(new Error("CONFIG_INVALID: malformed project"), {
          code: "CONFIG_INVALID",
        });
      },
    },
  });

  await program.parseAsync(["node", "openspec-orch", "doctor", "--json"]);

  const report = JSON.parse(output[0]);
  assert.equal(report.version, 1);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks[0].id, "store");
  assert.equal(report.checks[0].code, "CONFIG_INVALID");
  assert.equal(process.exitCode, 1);
});

test("automatic composition restores declared Plugins through injected services", async (t) => {
  const start = "/virtual/store";
  const loadedPlugin = await samplePlugin(t, []);
  const checkout = Object.freeze({ root: start });
  const declaration = Object.freeze({ id: "sample", source: "@test/plugin-sample@1.0.0" });
  const calls = [];
  const program = await createCandidateProgram({
    pluginManagerService: {
      forStore(received) {
        calls.push(["forStore", received]);
        return {
          async resolve(candidate) {
            calls.push(["resolvePlugin", candidate]);
            return Object.freeze({ loadedPlugin });
          },
        };
      },
    },
    start,
    storeProjectService: {
      async resolve(received) {
        calls.push(["resolveStore", received]);
        return Object.freeze({
          checkout,
          project: Object.freeze({ pluginDeclarations: Object.freeze([declaration]) }),
        });
      },
    },
  });

  assert.deepEqual(calls, [
    ["resolveStore", start],
    ["forStore", checkout],
    ["resolvePlugin", declaration],
  ]);
  assert.equal(program.commands.some((command) => command.name() === "sample"), true);
});

test("command context preserves start and selects current or Store scope explicitly", async (t) => {
  const calls = [];
  const contextCalls = [];
  const start = "/virtual/workspace/repositories/frontend";
  const commandPlugin = definePlugin({
    id: "sample",
    supports: ["store", "code"],
    repository: {
      connect() {},
      status() { return { state: "ready" }; },
    },
    registerCommands(commands) {
      commands.command("current-scope").description("Current")
        .actionWithContext((context) => calls.push(context));
      commands.command("store-scope").description("Store")
        .actionWithContext((context) => calls.push(context), { scope: "store" });
      commands.command("store-history").description("Store history")
        .actionWithContext((context) => calls.push(context), { scope: "store", requireBinding: false });
    },
  });
  const scopedPlugin = await loadPluginExport(t, commandPlugin);
  const storeProject = { store: { id: "specs" } };
  const invocation = Object.freeze({ id: "frontend", role: "code", path: start });
  const storeStarts = [];
  const program = await createCandidateProgram({
    currentRepositoryService: {
      async resolve(input) {
        assert.equal(input.start, start);
        return invocation;
      },
    },
    loadedPlugins: [scopedPlugin],
    pluginContextFactory: {
      async forRepository(input) {
        contextCalls.push(["connected", input.repositoryId]);
        return Object.freeze({ invocation: input.invocation, repositoryId: input.repositoryId });
      },
      async forRepositorySetup(input) {
        contextCalls.push(["unbound", input.repositoryId]);
        return Object.freeze({ invocation: input.invocation, repositoryId: input.repositoryId });
      },
    },
    start,
    storeProjectService: {
      async resolve(received) {
        storeStarts.push(received);
        return storeProject;
      },
    },
  });

  await program.parseAsync(["node", "openspec-orch", "sample", "current-scope"]);
  await program.parseAsync(["node", "openspec-orch", "sample", "store-scope"]);
  await program.parseAsync(["node", "openspec-orch", "sample", "store-history"]);
  assert.deepEqual(storeStarts, [start]);
  assert.deepEqual(calls.map(({ repositoryId }) => repositoryId), ["frontend", "specs", "specs"]);
  assert.equal(calls.every((context) => context.invocation === invocation), true);
  assert.deepEqual(contextCalls.map(([kind]) => kind), ["connected", "connected", "unbound"]);
});

test("bundled provider initializes and restores a Plugin without Store runtime", async (t) => {
  const storeRoot = await storeFixture(t, { declared: false });
  const output = [];
  const bundledProvider = new BundledPluginProvider([new BundledPluginPackage({
    id: "sample",
    name: "Sample Plugin",
    packageName: "@test/openspec-orch-plugin-sample",
    packageRoot: SAMPLE_PLUGIN_ROOT,
    version: "1.0.0",
  })]);
  const options = {
    bundledProvider,
    pluginCommandOptions: { output: { log: (value) => output.push(value) } },
  };
  const previousCwd = process.cwd();
  process.chdir(storeRoot);
  try {
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "init",
      "--all",
    ]);
    const restarted = await createCandidateProgram(options);
    assert.equal(restarted.commands.some((command) => command.name() === "sample"), true);
    await restarted.parseAsync(["node", "openspec-orch", "sample", "hello"]);
    await (await createCandidateProgram(options)).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "init",
      "--plugin",
      "sample",
    ]);
  } finally {
    process.chdir(previousCwd);
  }

  const project = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.equal(
    project.pluginDeclaration("sample").source,
    "@test/openspec-orch-plugin-sample@1.0.0",
  );
  assert.equal(await fs.lstat(path.join(
    storeRoot,
    ".openspec-orch/cache/plugin-runtimes",
  )).catch((error) => error.code), "ENOENT");
  assert.deepEqual(output, [
    "✓ sample — инициализирован",
    "Далее: openspec-orch plugin connect <plugin-id>",
    "✓ sample — уже инициализирован",
    "Далее: openspec-orch plugin connect <plugin-id>",
  ]);
});

test("automatic composition skips unavailable runtime but rejects corrupted cache", async (t) => {
  const storeRoot = await storeFixture(t);
  const project = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  project.connectPlugin("sample", ["frontend"]);
  await fs.writeFile(
    path.join(storeRoot, "openspec-orch.yaml"),
    configuration.serializeProject(project),
  );
  const output = [];
  const previousCwd = process.cwd();
  process.chdir(storeRoot);
  try {
    const repairable = await createCandidateProgram({
      pluginCommandOptions: { output: { log: (value) => output.push(value) } },
    });
    assert.equal(repairable.commands.some((command) => command.name() === "plugin"), true);
    assert.equal(repairable.commands.some((command) => command.name() === "sample"), false);
    await repairable.parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "disconnect",
      "sample",
      "--repo",
      "frontend",
    ]);
    const disconnected = configuration.parseProject(
      await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
    );
    assert.equal(disconnected.isPluginConnected("sample", "frontend"), false);
    assert.deepEqual(output, ["✓ sample → frontend — отключён"]);

    const runtimeDirectory = path.join(
      storeRoot,
      ".openspec-orch/cache/plugin-runtimes/sample",
    );
    await fs.mkdir(runtimeDirectory, { recursive: true });
    await fs.writeFile(path.join(runtimeDirectory, "unexpected"), "corrupted");
    await assert.rejects(createCandidateProgram(), /PLUGIN_MANAGER_INVALID/);
  } finally {
    process.chdir(previousCwd);
  }
});
