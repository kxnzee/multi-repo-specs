/** @fileoverview Проверки неизменной CLI-грамматики Plugin lifecycle. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateCli,
  createProject,
  PluginCatalog,
  PluginCatalogEntry,
  PluginLifecycleCommands,
  PluginSource,
} from "@openspec-orch/core";

/** Создаёт output boundary без подмены global console. */
function outputCollector() {
  const lines = [];
  return { lines, output: { log: (value) => lines.push(value) } };
}

/** Создаёт Project registry для интерактивного repository checkbox. */
function promptProject() {
  return createProject({
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
}

/** Собирает Candidate CLI с тестовыми lifecycle boundaries. */
function candidate({
  applicationService,
  catalog,
  checkboxPrompt,
  lifecycleService,
  output,
  stdin,
  stdout,
  storeProjectService,
}) {
  const pluginLifecycleCommands = new PluginLifecycleCommands({
    applicationService,
    catalog,
    checkboxPrompt,
    lifecycleService,
    output,
    stdin,
    stdout,
    storeProjectService,
  });
  return new CandidateCli({ pluginLifecycleCommands }).createProgram();
}

test("plugin init preserves --plugin/--from grammar and delegates to application facade", async () => {
  const calls = [];
  const captured = outputCollector();
  const storeProject = Object.freeze({ root: "/store" });
  const program = candidate({
    applicationService: {
      async install(current, pluginId, source) {
        calls.push({ current, pluginId, source });
        return { initialized: true };
      },
      async remove() {},
    },
    lifecycleService: {
      async connectMany() { return []; },
      async disconnect() {},
      async statuses() { return []; },
      async sync() {},
    },
    output: captured.output,
    storeProjectService: { async find() { return storeProject; } },
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "init",
    "--plugin",
    "sample",
    "--from",
    "../sample-plugin",
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].current, storeProject);
  assert.equal(calls[0].pluginId, "sample");
  assert.equal(calls[0].source instanceof PluginSource, true);
  assert.equal(calls[0].source.declaration, "local");
  assert.deepEqual(captured.lines, [
    "sample: initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
  ]);
});

test("plugin init rejects ambiguous custom source selection before Store lookup", async () => {
  let finds = 0;
  const program = candidate({
    applicationService: { async install() {}, async remove() {} },
    lifecycleService: {
      async connectMany() { return []; },
      async disconnect() {},
      async statuses() { return []; },
      async sync() {},
    },
    output: outputCollector().output,
    storeProjectService: { async find() { finds += 1; } },
  });

  await assert.rejects(
    program.parseAsync([
      "node",
      "openspec-orch",
      "plugin",
      "init",
      "--all",
      "--from",
      "../sample-plugin",
    ]),
    /PLUGIN_INIT_SELECTION_REQUIRED/,
  );
  assert.equal(finds, 0);
});

test("plugin init installs discovered catalog entries through --all", async () => {
  const calls = [];
  const captured = outputCollector();
  const storeProject = Object.freeze({ root: "/store" });
  const entries = [
    new PluginCatalogEntry({
      id: "zeta",
      name: "Zeta",
      source: PluginSource.parse("@test/plugin-zeta@1.0.0"),
    }),
    new PluginCatalogEntry({
      id: "alpha",
      name: "Alpha",
      source: PluginSource.parse("@test/plugin-alpha@1.0.0"),
    }),
  ];
  const applicationService = {
    async install(current, pluginId, source) {
      calls.push({ current, pluginId, source });
      return { initialized: pluginId !== "zeta" };
    },
    async remove() {},
  };
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnect() {},
    async statuses() { return []; },
    async sync() {},
  };
  const program = candidate({
    applicationService,
    catalog: new PluginCatalog(entries),
    lifecycleService,
    output: captured.output,
    storeProjectService: { async find() { return storeProject; } },
  });

  await program.parseAsync(["node", "openspec-orch", "plugin", "init", "--all"]);

  assert.deepEqual(calls.map(({ pluginId }) => pluginId), ["alpha", "zeta"]);
  assert.equal(calls.every(({ current }) => current === storeProject), true);
  assert.equal(calls.every(({ source }) => source.kind === "npm"), true);
  assert.deepEqual(captured.lines, [
    "alpha: initialized",
    "zeta: already_initialized",
    "Далее: openspec-orch plugin connect <plugin-id>",
  ]);
});

test("plugin init uses checkbox catalog selection and requires TTY", async () => {
  const calls = [];
  const prompts = [];
  const captured = outputCollector();
  const catalog = new PluginCatalog([new PluginCatalogEntry({
    id: "sample",
    name: "Sample Plugin",
    source: PluginSource.parse("@test/plugin-sample@1.0.0"),
  })]);
  const applicationService = {
    async install(_current, pluginId) {
      calls.push(pluginId);
      return { initialized: true };
    },
    async remove() {},
  };
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnect() {},
    async statuses() { return []; },
    async sync() {},
  };
  const storeProjectService = { async find() { return Object.freeze({ root: "/store" }); } };
  const interactive = candidate({
    applicationService,
    catalog,
    checkboxPrompt: async (options) => {
      prompts.push(options);
      return ["sample"];
    },
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    storeProjectService,
  });

  await interactive.parseAsync(["node", "openspec-orch", "plugin", "init"]);

  assert.deepEqual(prompts, [{
    message: "Выберите Plugins",
    choices: [{ name: "Sample Plugin (sample)", value: "sample" }],
  }]);
  assert.deepEqual(calls, ["sample"]);

  const nonInteractive = candidate({
    applicationService,
    catalog,
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    storeProjectService,
  });
  await assert.rejects(
    nonInteractive.parseAsync(["node", "openspec-orch", "plugin", "init"]),
    /Интерактивный выбор требует TTY/,
  );
});

test("plugin connect preserves repeated --repo grammar and current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const program = candidate({
    lifecycleService: {
      async connectMany(options) {
        calls.push(options);
        return [
          { repositoryId: "frontend", connected: true, output: "configured" },
          { repositoryId: "backend", connected: false, output: "" },
        ];
      },
      async disconnect() {},
      async statuses() { return []; },
      async sync() {},
    },
    output: captured.output,
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "connect",
    "sample",
    "--repo",
    "frontend",
    "--repo",
    "backend",
  ]);

  assert.deepEqual(calls, [{
    pluginId: "sample",
    repositoryIds: ["frontend", "backend"],
  }]);
  assert.deepEqual(captured.lines, [
    "sample -> frontend: connected",
    "configured",
    "sample -> backend: already_connected",
  ]);
});

test("plugin connect keeps checkbox UX and rejects implicit selection without TTY", async () => {
  const project = promptProject();
  const prompts = [];
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany(options) {
      calls.push(options);
      return [{ repositoryId: "frontend", connected: true, output: "" }];
    },
    async disconnect() {},
    async statuses() { return []; },
    async sync() {},
  };
  const storeProjectService = { async find() { return { project }; } };
  const program = candidate({
    checkboxPrompt: async (options) => {
      prompts.push(options);
      return ["frontend"];
    },
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    storeProjectService,
  });

  await program.parseAsync(["node", "openspec-orch", "plugin", "connect", "sample"]);

  assert.deepEqual(prompts[0], {
    message: "Подключить sample к repositories",
    choices: [
      { name: "specs [store]", value: "specs" },
      { name: "frontend [code]", value: "frontend" },
    ],
  });
  assert.deepEqual(calls[0].repositoryIds, ["frontend"]);

  const nonInteractive = candidate({
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    storeProjectService,
  });
  await assert.rejects(
    nonInteractive.parseAsync(["node", "openspec-orch", "plugin", "connect", "sample"]),
    /Интерактивный выбор требует TTY/,
  );
});

test("plugin status preserves filters, JSON shape and unavailable rows", async () => {
  const calls = [];
  const captured = outputCollector();
  const statuses = [{
    pluginId: "sample",
    repositoryId: "frontend",
    state: "unavailable",
    output: "line one\nline two",
  }];
  const program = candidate({
    lifecycleService: {
      async connectMany() { return []; },
      async disconnect() {},
      async statuses(options) {
        calls.push(options);
        return statuses;
      },
      async sync() {},
    },
    output: captured.output,
  });

  await program.parseAsync([
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

  assert.deepEqual(calls, [{ pluginId: "sample", repositoryId: "frontend" }]);
  assert.deepEqual(JSON.parse(captured.lines[0]), { plugins: statuses });
});

test("plugin human status and sync preserve current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnect() {},
    async statuses() {
      return [{
        pluginId: "sample",
        repositoryId: "frontend",
        state: "ready",
        output: "line one\nline two",
      }];
    },
    async sync(options) {
      calls.push(options);
      return "synced output";
    },
  };
  const statusProgram = candidate({ lifecycleService, output: captured.output });
  await statusProgram.parseAsync(["node", "openspec-orch", "plugin", "status"]);
  const syncProgram = candidate({ lifecycleService, output: captured.output });
  await syncProgram.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "sync",
    "sample",
    "--repo",
    "frontend",
  ]);

  assert.deepEqual(calls, [{ pluginId: "sample", repositoryId: "frontend" }]);
  assert.deepEqual(captured.lines, [
    "sample -> frontend: ready",
    "  line one\n  line two",
    "sample -> frontend: synced",
    "synced output",
  ]);
});

test("plugin disconnect preserves mandatory --repo grammar and current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnect(options) {
      calls.push(options);
      return { disconnected: calls.length === 1 };
    },
    async statuses() { return []; },
    async sync() {},
  };

  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "disconnect",
    "sample",
    "--repo",
    "frontend",
  ]);
  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "disconnect",
    "sample",
    "--repo",
    "frontend",
  ]);

  assert.deepEqual(calls, [
    { pluginId: "sample", repositoryId: "frontend" },
    { pluginId: "sample", repositoryId: "frontend" },
  ]);
  assert.deepEqual(captured.lines, [
    "sample -> frontend: disconnected",
    "sample -> frontend: not_connected",
  ]);
});

test("plugin remove delegates to application facade and preserves current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const storeProject = Object.freeze({ root: "/store" });
  const applicationService = {
    async install() {},
    async remove(current, pluginId) {
      calls.push({ current, pluginId });
      return { removed: calls.length === 1 };
    },
  };
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnect() {},
    async statuses() { return []; },
    async sync() {},
  };
  const storeProjectService = { async find() { return storeProject; } };

  await candidate({
    applicationService,
    lifecycleService,
    output: captured.output,
    storeProjectService,
  }).parseAsync(["node", "openspec-orch", "plugin", "remove", "sample"]);
  await candidate({
    applicationService,
    lifecycleService,
    output: captured.output,
    storeProjectService,
  }).parseAsync(["node", "openspec-orch", "plugin", "remove", "sample"]);

  assert.deepEqual(calls, [
    { current: storeProject, pluginId: "sample" },
    { current: storeProject, pluginId: "sample" },
  ]);
  assert.deepEqual(captured.lines, ["sample: removed", "sample: not_initialized"]);
});
