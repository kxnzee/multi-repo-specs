/** @fileoverview Интеграционный контракт discovery и repository lifecycle CLI Plugins. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  parseOrchestratorConfig,
  serializeOrchestratorConfig,
} from "../src/internal/config/index.js";
import {
  connectPlugin,
  connectPluginRepositories,
  disconnectPlugin,
  discoverPlugins,
  initializePlugins,
  readPluginStatus,
  removePlugin,
  runPluginCommand,
  syncPlugin,
} from "../src/internal/plugin/index.js";
import { routeNativePluginCommand } from "../src/internal/plugin/router.js";
import { runCommand } from "../src/internal/shared/command.js";
import { temporaryDirectory, writeFiles } from "../test-fixtures/workspace.js";

/**
 * Создаёт минимальный Store в стандартном multi-repo workspace.
 *
 * @param {import("node:test").TestContext} t Test context.
 * @returns {Promise<{workspace: string, storeRoot: string, codeRoot: string}>}
 */
async function createStore(t, repositoryIds = ["frontend"]) {
  const workspace = await temporaryDirectory(t, "openspec-orchestrator-plugin-");
  const storeRoot = path.join(workspace, "specs");
  const codeRoots = Object.fromEntries(repositoryIds.map((repositoryId) => [
    repositoryId,
    path.join(workspace, "src", repositoryId),
  ]));
  await Promise.all(Object.values(codeRoots).map((root) => fs.mkdir(root, { recursive: true })));
  const codeRepositories = repositoryIds.map((repositoryId) => `  - id: ${repositoryId}
    roles: [code]
    remote: https://example.test/${repositoryId}.git
    default_branch: main`).join("\n");
  await writeFiles(storeRoot, {
    ".openspec-store/store.yaml": "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec-orch.yaml": `version: 1
strict: true
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
${codeRepositories}
extensions: {}
`,
  });
  return { workspace, storeRoot, codeRoot: codeRoots.frontend, codeRoots };
}

/** Сохраняет зарегистрированных Agents в актуальном project-config contract. */
async function registerAgents(storeRoot, agents) {
  const configPath = path.join(storeRoot, "openspec-orch.yaml");
  const current = parseOrchestratorConfig(await fs.readFile(configPath, "utf8"));
  const source = serializeOrchestratorConfig(
    "version: 2\nagents: []\nplugins: []\nrepositories: []\n",
    current.repositories,
    { strict: current.strict, agents, plugins: current.plugins },
  );
  await fs.writeFile(configPath, source, "utf8");
}

/**
 * Создаёт пользовательский каталог из одного или нескольких Plugin packages.
 *
 * @param {import("node:test").TestContext} t Test context.
 * @param {Record<string, string>} descriptors Descriptor по package directory.
 * @returns {Promise<string>} Catalog root.
 */
async function createPluginCatalog(t, descriptors) {
  const catalog = await temporaryDirectory(t, "openspec-orchestrator-plugin-catalog-");
  const files = {};
  for (const [directory, descriptor] of Object.entries(descriptors)) {
    files[`${directory}/package.json`] = `${JSON.stringify({
      name: `@test/${directory}`,
      version: "1.0.0",
      openspecOrchestrator: {
        apiVersion: 1,
        manifest: "plugin.yaml",
      },
    }, null, 2)}\n`;
    files[`${directory}/plugin.yaml`] = descriptor;
    files[`${directory}/README.md`] = `# ${directory}\n`;
  }
  await writeFiles(catalog, files);
  return catalog;
}

const DEMO_DESCRIPTOR = `id: demo
name: Demo Plugin
version: 1.0.0
type: cli
command: demo-plugin
args: [--team]
supports: [store, code]
lifecycle:
  connect: [bootstrap, .]
  status: [status, .]
  sync: [sync, .]
`;

test("discovers every Plugin Package declared by the distribution", async () => {
  const distribution = JSON.parse(await fs.readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
  ));
  const discovered = await discoverPlugins();
  assert.deepEqual(
    discovered.map(({ packageManifest }) => packageManifest.name),
    distribution.openspecOrchestrator.bundledPlugins,
  );
});

test("runs a bundled Plugin through its Package entrypoint", async (t) => {
  const { storeRoot, codeRoot } = await createStore(t);
  await registerAgents(storeRoot, ["qwen"]);
  const [bundled] = await discoverPlugins();
  assert.ok(bundled);
  const repositoryId = bundled.descriptor.supports.includes("code") ? "frontend" : "specs";
  const calls = [];
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return "initialized";
  };
  await initializePlugins({ storeRoot, pluginIds: [bundled.descriptor.id] });

  assert.deepEqual(
    await connectPlugin({
      storeRoot,
      pluginId: bundled.descriptor.id,
      repositoryId,
      commandRunner,
    }),
    { connected: true, output: "initialized" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(
    path.basename(calls[0].args[0]),
    path.basename(bundled.packageManifest.openspecOrchestrator.entrypoint),
  );
  assert.deepEqual(calls[0].args.slice(1), bundled.descriptor.lifecycle.connect);
  assert.equal(calls[0].cwd, repositoryId === "frontend" ? codeRoot : storeRoot);
});

test("runs init, connect, status, sync, native command, disconnect and remove", async (t) => {
  const { storeRoot, codeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  const calls = [];
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return `${args.join(" ")} @ ${path.basename(options.cwd)}`;
  };

  assert.deepEqual(
    await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] }),
    { initialized: ["demo"], alreadyInitialized: [], agentIntegrations: [] },
  );
  const initializedConfig = parseOrchestratorConfig(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.equal(initializedConfig.version, 2);
  assert.deepEqual(initializedConfig.plugins, ["demo"]);
  assert.equal(
    await fs.readFile(path.join(storeRoot, ".openspec-orch", "cache", "plugins", "demo", "README.md"), "utf8"),
    "# demo\n",
  );

  const storeConnection = await connectPlugin({
    storeRoot,
    pluginId: "demo",
    repositoryId: "specs",
    commandRunner,
  });
  const codeConnection = await connectPlugin({
    storeRoot,
    pluginId: "demo",
    repositoryId: "frontend",
    commandRunner,
  });
  assert.equal(storeConnection.connected, true);
  assert.equal(codeConnection.connected, true);
  assert.deepEqual(calls.slice(0, 2), [
    { command: "demo-plugin", args: ["--team", "bootstrap", "."], cwd: storeRoot },
    { command: "demo-plugin", args: ["--team", "bootstrap", "."], cwd: codeRoot },
  ]);
  assert.deepEqual(
    await connectPlugin({ storeRoot, pluginId: "demo", repositoryId: "frontend", commandRunner }),
    { connected: false, output: "" },
  );

  const statuses = await readPluginStatus({ storeRoot, pluginId: "demo", commandRunner });
  assert.deepEqual(statuses.map(({ repositoryId, state }) => [repositoryId, state]), [
    ["specs", "ready"],
    ["frontend", "ready"],
  ]);
  assert.deepEqual(
    await routeNativePluginCommand(
      ["demo", "--repository", "frontend", "explore", "authentication flow"],
      { cwd: storeRoot, commandRunner },
    ),
    {
      pluginId: "demo",
      repositoryId: "frontend",
      output: "--team explore authentication flow @ frontend",
    },
  );
  assert.equal(
    await syncPlugin({ storeRoot, pluginId: "demo", repositoryId: "frontend", commandRunner }),
    "--team sync . @ frontend",
  );
  assert.equal(
    await runPluginCommand({
      storeRoot,
      pluginId: "demo",
      repositoryId: "frontend",
      args: ["explore", "authentication flow"],
      commandRunner,
    }),
    "--team explore authentication flow @ frontend",
  );

  assert.equal(await disconnectPlugin({ storeRoot, pluginId: "demo", repositoryId: "frontend" }), true);
  await assert.rejects(
    runPluginCommand({
      storeRoot,
      pluginId: "demo",
      repositoryId: "frontend",
      args: ["explore"],
      commandRunner,
    }),
    /PLUGIN_NOT_CONNECTED/,
  );
  assert.equal(await disconnectPlugin({ storeRoot, pluginId: "demo", repositoryId: "specs" }), true);
  assert.equal(await removePlugin({ storeRoot, pluginId: "demo" }), true);
  const removedConfig = parseOrchestratorConfig(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(removedConfig.plugins, []);
  await assert.rejects(
    fs.stat(path.join(storeRoot, ".openspec-orch", "cache", "plugins", "demo")),
    { code: "ENOENT" },
  );
});

test("installs a Plugin Package from a local tarball source", async (t) => {
  const { storeRoot, codeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { archive: DEMO_DESCRIPTOR });
  const packageRoot = path.join(catalog, "archive");
  const packagePath = path.join(packageRoot, "package.json");
  const packageManifest = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageManifest.openspecOrchestrator.entrypoint = "bin/plugin.js";
  await fs.writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await fs.mkdir(path.join(packageRoot, "bin"));
  await fs.writeFile(path.join(packageRoot, "bin", "plugin.js"), "// test entrypoint\n", "utf8");
  const packRoot = await temporaryDirectory(t, "openspec-orchestrator-plugin-pack-");
  const packed = JSON.parse(await runCommand(
    "npm",
    ["pack", "--json", "--pack-destination", packRoot, "--cache", path.join(packRoot, "cache")],
    { cwd: packageRoot },
  ));
  const tarball = path.join(packRoot, packed[0].filename);
  const calls = [];
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return "connected";
  };

  await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [tarball] });
  await connectPlugin({
    storeRoot,
    pluginId: "demo",
    repositoryId: "frontend",
    commandRunner,
  });

  assert.deepEqual(calls, [{
    command: process.execPath,
    args: [
      path.join(storeRoot, ".openspec-orch", "cache", "plugins", "demo", "bin", "plugin.js"),
      "--team",
      "bootstrap",
      ".",
    ],
    cwd: codeRoot,
  }]);
});

test("installs local Plugin Package dependencies without lifecycle scripts", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  const packagePath = path.join(catalog, "demo", "package.json");
  const packageManifest = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageManifest.dependencies = { "runtime-package": "1.0.0" };
  await fs.writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  const calls = [];
  const packageInstaller = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return "";
  };

  await initializePlugins({
    storeRoot,
    pluginIds: ["demo"],
    sourceRoots: [catalog],
    packageInstaller,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  assert.equal(path.basename(path.dirname(calls[0].cwd)), "plugins");
});

test("runs Plugin-owned Agent lifecycle for every registered Agent", async (t) => {
  const { storeRoot } = await createStore(t);
  await registerAgents(storeRoot, ["qwen", "codex"]);
  const descriptor = `${DEMO_DESCRIPTOR}agent:
  install: [agent, install]
  remove: [agent, remove]
`;
  const catalog = await createPluginCatalog(t, { demo: descriptor });
  const packageRoot = path.join(catalog, "demo");
  const packagePath = path.join(packageRoot, "package.json");
  const packageManifest = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageManifest.openspecOrchestrator.entrypoint = "bin/plugin.js";
  await fs.writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await writeFiles(packageRoot, {
    "bin/plugin.js": "// test MCP entrypoint\n",
  });
  const calls = [];
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    return "ready";
  };

  await initializePlugins({
    storeRoot,
    pluginIds: ["demo"],
    sourceRoots: [catalog],
    commandRunner,
  });
  const entrypoint = path.join(
    storeRoot,
    ".openspec-orch",
    "cache",
    "plugins",
    "demo",
    "bin",
    "plugin.js",
  );
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: [entrypoint, "--team", "agent", "install", "--agent", "qwen"],
      cwd: storeRoot,
    },
    {
      command: process.execPath,
      args: [entrypoint, "--team", "agent", "install", "--agent", "codex"],
      cwd: storeRoot,
    },
  ]);

  await assert.rejects(
    removePlugin({
      storeRoot,
      pluginId: "demo",
      commandRunner: async () => {
        throw new Error("agent remove failed");
      },
    }),
    /agent remove failed/,
  );
  assert.deepEqual(
    parseOrchestratorConfig(
      await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
    ).plugins,
    ["demo"],
  );
  await fs.access(entrypoint);

  assert.equal(await removePlugin({ storeRoot, pluginId: "demo", commandRunner }), true);
  assert.deepEqual(calls.slice(2), [
    {
      command: process.execPath,
      args: [entrypoint, "--team", "agent", "remove", "--agent", "qwen"],
      cwd: storeRoot,
    },
    {
      command: process.execPath,
      args: [entrypoint, "--team", "agent", "remove", "--agent", "codex"],
      cwd: storeRoot,
    },
  ]);
});

test("rejects Agent-integrated Plugin when Store has no registered Agents", async (t) => {
  const { storeRoot } = await createStore(t);
  const descriptor = `${DEMO_DESCRIPTOR}agent:
  install: [agent, install]
  remove: [agent, remove]
`;
  const catalog = await createPluginCatalog(t, { demo: descriptor });

  await assert.rejects(
    initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] }),
    /PLUGIN_AGENT_NOT_REGISTERED: для Plugin 'demo' не зарегистрирован ни один Agent/,
  );
  await assert.rejects(
    fs.access(path.join(storeRoot, ".openspec-orch", "cache", "plugins", "demo")),
  );
});

test("rejects changed Package metadata for an initialized Plugin version", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] });
  const packagePath = path.join(catalog, "demo", "package.json");
  const packageManifest = JSON.parse(await fs.readFile(packagePath, "utf8"));
  packageManifest.dependencies = { "another-runtime": "1.0.0" };
  await fs.writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] }),
    /PLUGIN_VERSION_MISMATCH: demo уже установлен с другим package contract/,
  );
});

test("checks Plugin status with bounded concurrency and stable result order", async (t) => {
  const repositoryIds = ["service-a", "service-b", "service-c", "service-d", "service-e"];
  const { storeRoot } = await createStore(t, repositoryIds);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] });
  let connectActive = 0;
  let connectMaximum = 0;
  const connectRunner = async () => {
    connectActive += 1;
    connectMaximum = Math.max(connectMaximum, connectActive);
    await delay(10);
    connectActive -= 1;
    return "connected";
  };
  const connections = await connectPluginRepositories({
    storeRoot,
    pluginId: "demo",
    repositoryIds,
    commandRunner: connectRunner,
  });
  assert.deepEqual(connections.map(({ repositoryId }) => repositoryId), repositoryIds);
  assert.equal(connectMaximum, 4);

  let active = 0;
  let maximum = 0;
  const statusRunner = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(10);
    active -= 1;
    return "ready";
  };
  const statuses = await readPluginStatus({ storeRoot, pluginId: "demo", commandRunner: statusRunner });
  assert.deepEqual(statuses.map(({ repositoryId }) => repositoryId), repositoryIds);
  assert.equal(maximum, 4);
});

test("rejects a Plugin ID reserved by the public CLI", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, {
    status: DEMO_DESCRIPTOR.replace("id: demo", "id: status"),
    help: DEMO_DESCRIPTOR.replace("id: demo", "id: help"),
  });
  for (const pluginId of ["status", "help"]) {
    await assert.rejects(
      initializePlugins({ storeRoot, pluginIds: [pluginId], sourceRoots: [catalog] }),
      /PLUGIN_ID_RESERVED/,
    );
  }
});

test("rejects descriptors without required connect and status lifecycle", async (t) => {
  const missingConnect = DEMO_DESCRIPTOR.replace("  connect: [bootstrap, .]\n", "");
  const missingStatus = DEMO_DESCRIPTOR.replace("  status: [status, .]\n", "");
  for (const [directory, descriptor] of Object.entries({ missingConnect, missingStatus })) {
    const catalog = await createPluginCatalog(t, { [directory]: descriptor });
    await assert.rejects(discoverPlugins([catalog]), /PLUGIN_INVALID/);
  }
});

test("rejects a symlink in the Store-local Plugin cache path", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  const outsideCache = await temporaryDirectory(t, "openspec-orchestrator-outside-plugin-cache-");
  const cacheParent = path.join(storeRoot, ".openspec-orch");
  await fs.mkdir(cacheParent, { recursive: true });
  await fs.symlink(
    outsideCache,
    path.join(cacheParent, "cache"),
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] }),
    /PLUGIN_CACHE_UNSAFE/,
  );
  await assert.rejects(fs.stat(path.join(outsideCache, "plugins", "demo")), { code: "ENOENT" });
});

test("does not unregister a Plugin when its cache path becomes unsafe", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] });
  const cacheRoot = path.join(storeRoot, ".openspec-orch", "cache");
  const outsideCache = await temporaryDirectory(t, "openspec-orchestrator-unsafe-plugin-remove-");
  await fs.rm(cacheRoot, { recursive: true });
  await fs.symlink(
    outsideCache,
    cacheRoot,
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(removePlugin({ storeRoot, pluginId: "demo" }), /PLUGIN_CACHE_UNSAFE/);
  const config = parseOrchestratorConfig(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(config.plugins, ["demo"]);
});

test("validates explicit Plugin status filters through ProjectModel", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  await initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] });

  await assert.rejects(
    readPluginStatus({ storeRoot, pluginId: "missing" }),
    /PLUGIN_NOT_INITIALIZED/,
  );
  await assert.rejects(
    readPluginStatus({ storeRoot, repositoryId: "missing" }),
    /REPO_UNKNOWN/,
  );
});

test("does not discard non-empty legacy extensions while initializing Plugins", async (t) => {
  const { storeRoot } = await createStore(t);
  const catalog = await createPluginCatalog(t, { demo: DEMO_DESCRIPTOR });
  const configPath = path.join(storeRoot, "openspec-orch.yaml");
  await fs.writeFile(
    configPath,
    (await fs.readFile(configPath, "utf8")).replace("extensions: {}", "extensions:\n  team: payments"),
    "utf8",
  );
  await assert.rejects(
    initializePlugins({ storeRoot, pluginIds: ["demo"], sourceRoots: [catalog] }),
    /CONFIG_MIGRATION_REQUIRED/,
  );
  assert.equal((await fs.readFile(configPath, "utf8")).includes("team: payments"), true);
});
