/** @fileoverview Проверка полного wiring Plugin Platform через candidate CLI. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { definePlugin } from "@openspec-orch/plugin-sdk";
import {
  configuration,
  createCandidateProgram,
  createProject,
  PluginHost,
  PluginLifecycleService,
  PluginLoader,
  PluginPlatform,
  PluginRegistry,
} from "@openspec-orch/core";

/** Создаёт реальный Store config для candidate lifecycle flow. */
async function storeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-platform-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".openspec-store"));
  await fs.mkdir(path.join(root, "openspec"));
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
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-platform-plugin-"));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const manifest = {
    name: "@test/openspec-orch-plugin-sample",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  };
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(packageRoot, "index.js"), "export default {};\n");
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
    },
    registerCommands(commands) {
      commands.command("hello")
        .description("Hello")
        .action(() => calls.push(["command", "hello"]));
    },
  });
  return new PluginLoader(async () => ({ default: plugin })).load({
    packageRoot: await fs.realpath(packageRoot),
    pluginId: "sample",
  });
}

test("PluginPlatform wires sample lifecycle and namespaced command into candidate CLI", async (t) => {
  const storeRoot = await storeFixture(t);
  const calls = [];
  const loadedPlugin = await samplePlugin(t, calls);
  const output = [];
  const options = {
    loadedPlugins: [loadedPlugin],
    pluginCliOptions: { output: { log: (value) => output.push(value) } },
    pluginContextFactory: {
      async forRepositorySetup({ repositoryId }) {
        return Object.freeze({ repositoryId });
      },
      async forRepository({ repositoryId }) {
        return Object.freeze({ repositoryId });
      },
    },
  };
  const platform = new PluginPlatform({
    contextFactory: options.pluginContextFactory,
    loadedPlugins: options.loadedPlugins,
    pluginCliOptions: options.pluginCliOptions,
  });
  assert.equal(platform.registry instanceof PluginRegistry, true);
  assert.equal(platform.host instanceof PluginHost, true);
  assert.equal(platform.lifecycle instanceof PluginLifecycleService, true);

  const previousCwd = process.cwd();
  process.chdir(storeRoot);
  try {
    await createCandidateProgram(options).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "connect",
      "sample",
      "--repo",
      "frontend",
    ]);
    output.length = 0;
    await createCandidateProgram(options).parseAsync([
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
    await createCandidateProgram(options).parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "sync",
      "sample",
      "--repo",
      "frontend",
    ]);
    await createCandidateProgram(options).parseAsync([
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
    ["sync", "frontend"],
    ["command", "hello"],
  ]);
  assert.deepEqual(output, ["sample -> frontend: synced", "updated"]);
});

test("empty composition still exposes Core plugin lifecycle without Plugin-specific branches", () => {
  const program = createCandidateProgram();
  assert.equal(program.commands.some((command) => command.name() === "plugin"), true);
  assert.equal(program.commands.some((command) => command.name() === "sample"), false);
});
