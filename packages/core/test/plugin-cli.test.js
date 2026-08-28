/** @fileoverview Проверки неизменной CLI-грамматики Plugin lifecycle. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateCli,
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

/** Выполняет operations без записи progress в test runner stderr. */
function silentProgress() {
  return {
    async run(_message, operation) { return operation(); },
  };
}

/** Собирает Candidate CLI с тестовыми lifecycle boundaries. */
function candidate({
  applicationService,
  catalog,
  checkboxPrompt,
  lifecycleService,
  output,
  progress = silentProgress(),
  scaffoldService,
  stdin,
  stdout,
  storeProjectService,
}) {
  const pluginLifecycleCommands = new PluginLifecycleCommands({
    applicationService,
    catalog,
    checkboxPrompt,
    lifecycleService: {
      async disconnectMany() { return []; },
      async execMany() { return []; },
      async repositoryCandidates() { return []; },
      async syncMany() { return []; },
      ...lifecycleService,
    },
    output,
    progress,
    scaffoldService,
    stdin,
    stdout,
    storeProjectService,
  });
  return new CandidateCli({ pluginLifecycleCommands }).createProgram();
}

test("plugin register delegates the selected profile and optional Extension", async () => {
  const calls = [];
  const captured = outputCollector();
  const program = candidate({
    applicationService: { async install() {}, async remove() {} },
    lifecycleService: {
      async connectMany() { return []; },
      async statuses() { return []; },
    },
    output: captured.output,
    scaffoldService: {
      async register(options) {
        calls.push(options);
        return { root: "/plugins/sample", entrypoint: "/plugins/sample/index.js" };
      },
    },
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "register",
    "sample",
    "../sample-plugin",
    "--name",
    "Sample Plugin",
    "--profile",
    "native",
    "--support",
    "store",
    "--support",
    "code",
    "--extension",
  ]);

  assert.deepEqual(calls, [{
    pluginId: "sample",
    targetRoot: "../sample-plugin",
    name: "Sample Plugin",
    profile: "native",
    supports: ["store", "code"],
    extension: true,
  }]);
  assert.deepEqual(captured.lines, [
    "sample: registered at /plugins/sample",
    "Entrypoint: /plugins/sample/index.js",
    "После реализации: openspec-orch plugin init --from /plugins/sample --plugin sample",
  ]);
});

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
      async statuses() { return []; },
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
  assert.equal(calls[0].source.declaration, "../sample-plugin");
  assert.deepEqual(captured.lines, [
    "✓ sample — инициализирован",
    "Далее: openspec-orch plugin connect <plugin-id>",
  ]);
});

test("plugin init rejects ambiguous custom source selection before Store lookup", async () => {
  let finds = 0;
  const program = candidate({
    applicationService: { async install() {}, async remove() {} },
    lifecycleService: {
      async connectMany() { return []; },
      async statuses() { return []; },
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
    async statuses() { return []; },
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
  assert.equal(calls.every(({ source }) => source.kind === "external"), true);
  assert.deepEqual(captured.lines, [
    "✓ alpha — инициализирован",
    "✓ zeta — уже инициализирован",
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
    async statuses() { return []; },
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
    theme: { icon: { checked: "[✓]", unchecked: "[ ]" } },
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
      async statuses() { return []; },
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
    "✓ sample → frontend — подключён",
    "configured",
    "✓ sample → backend — уже подключён",
  ]);
});

test("plugin connect keeps checkbox UX and supports explicit --all", async () => {
  const prompts = [];
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany(options) {
      calls.push(options);
      return [{ repositoryId: "frontend", connected: true, output: "" }];
    },
    async repositoryCandidates(options) {
      calls.push(["candidates", options]);
      return [
        { id: "specs", role: "store" },
        { id: "frontend", role: "code" },
      ];
    },
    async statuses() { return []; },
  };
  const program = candidate({
    checkboxPrompt: async (options) => {
      prompts.push(options);
      return ["frontend"];
    },
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
  });

  await program.parseAsync(["node", "openspec-orch", "plugin", "connect", "sample"]);

  assert.deepEqual(prompts[0], {
    message: "Подключить sample к repositories",
    theme: { icon: { checked: "[✓]", unchecked: "[ ]" } },
    choices: [
      { name: "specs [store]", value: "specs" },
      { name: "frontend [code]", value: "frontend" },
    ],
  });
  assert.deepEqual(calls, [
    ["candidates", { operation: "connect", pluginId: "sample" }],
    { pluginId: "sample", repositoryIds: ["frontend"] },
  ]);

  calls.length = 0;
  await candidate({
    lifecycleService,
    output: captured.output,
  }).parseAsync(["node", "openspec-orch", "plugin", "connect", "sample", "--all"]);
  assert.deepEqual(calls, [
    ["candidates", { operation: "connect", pluginId: "sample" }],
    { pluginId: "sample", repositoryIds: ["specs", "frontend"] },
  ]);

  const nonInteractive = candidate({
    lifecycleService,
    output: captured.output,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
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
      async statuses(options) {
        calls.push(options);
        return statuses;
      },
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

test("plugin human status uses icons while sync preserves current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async statuses() {
      return [{
        pluginId: "sample",
        repositoryId: "frontend",
        state: "ready",
        output: "line one\nline two",
      }];
    },
    async syncMany(options) {
      calls.push(options);
      return [{ pluginId: "sample", repositoryId: "frontend", output: "synced output" }];
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

  assert.deepEqual(calls, [{ pluginId: "sample", repositoryIds: ["frontend"] }]);
  assert.deepEqual(captured.lines, [
    "✓ sample → frontend — готов",
    "  line one",
    "  line two",
    "✓ sample → frontend — синхронизирован",
    "synced output",
    "✓ sample → frontend — готов",
    "  line one",
    "  line two",
  ]);
});

test("plugin exec forwards the native argv tail to one connected instance", async () => {
  const calls = [];
  const captured = outputCollector();
  const program = candidate({
    lifecycleService: {
      async connectMany() { return []; },
      async execMany(options) {
        calls.push(options);
        return [{
          pluginId: "codegraph",
          repositoryId: "frontend",
          output: '{"initialized":true}',
        }];
      },
      async statuses() { return []; },
    },
    output: captured.output,
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "exec",
    "codegraph",
    "--repo",
    "frontend",
    "--",
    "status",
    "--json",
  ]);

  assert.deepEqual(calls, [{
    args: ["status", "--json"],
    pluginId: "codegraph",
    repositoryIds: ["frontend"],
  }]);
  assert.deepEqual(captured.lines, ['{"initialized":true}']);
});

test("plugin exec --all forwards the argv tail to all connected instances", async () => {
  const calls = [];
  const captured = outputCollector();
  const program = candidate({
    lifecycleService: {
      async connectMany() { return []; },
      async execMany(options) {
        calls.push(options);
        return [
          { pluginId: "codegraph", repositoryId: "frontend", output: "frontend output" },
          { pluginId: "codegraph", repositoryId: "backend", output: "backend output" },
        ];
      },
      async repositoryCandidates() {
        return [
          { id: "frontend", role: "code" },
          { id: "backend", role: "code" },
        ];
      },
      async statuses() { return []; },
    },
    output: captured.output,
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "exec",
    "codegraph",
    "--all",
    "--",
    "status",
    "--json",
  ]);

  assert.deepEqual(calls, [{
    args: ["status", "--json"],
    pluginId: "codegraph",
    repositoryIds: ["frontend", "backend"],
  }]);
  assert.deepEqual(captured.lines, [
    "✓ codegraph → frontend — команда выполнена",
    "frontend output",
    "✓ codegraph → backend — команда выполнена",
    "backend output",
  ]);
});

test("plugin sync without --repo uses checkbox selection", async () => {
  const calls = [];
  const prompts = [];
  const captured = outputCollector();
  const program = candidate({
    lifecycleService: {
      async connectMany() { return []; },
      async statuses() { return []; },
      async repositoryCandidates(options) {
        calls.push(["candidates", options]);
        return [
          { id: "frontend", role: "code" },
          { id: "backend", role: "code" },
        ];
      },
      async syncMany(options) {
        calls.push(options);
        return [{ pluginId: "sample", repositoryId: "frontend", output: "synced output" }];
      },
    },
    checkboxPrompt: async (options) => {
      prompts.push(options);
      return ["frontend", "backend"];
    },
    output: captured.output,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
  });

  await program.parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "sync",
    "sample",
  ]);

  assert.deepEqual(prompts, [{
    message: "Синхронизировать sample в repositories",
    theme: { icon: { checked: "[✓]", unchecked: "[ ]" } },
    choices: [
      { name: "frontend [code]", value: "frontend" },
      { name: "backend [code]", value: "backend" },
    ],
  }]);
  assert.deepEqual(calls, [
    ["candidates", { operation: "sync", pluginId: "sample" }],
    { pluginId: "sample", repositoryIds: ["frontend", "backend"] },
  ]);
  assert.deepEqual(captured.lines, [
    "✓ sample → frontend — синхронизирован",
    "synced output",
  ]);
});

test("plugin disconnect preserves explicit --repo grammar and current output", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnectMany(options) {
      calls.push(options);
      return [{ repositoryId: "frontend", disconnected: calls.length === 1 }];
    },
    async statuses() { return []; },
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
    { pluginId: "sample", repositoryIds: ["frontend"] },
    { pluginId: "sample", repositoryIds: ["frontend"] },
  ]);
  assert.deepEqual(captured.lines, [
    "✓ sample → frontend — отключён",
    "• sample → frontend — не был подключён",
  ]);
});

test("plugin disconnect --all removes all connected bindings", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnectMany(options) {
      calls.push(options);
      return [
        { repositoryId: "frontend", disconnected: true },
        { repositoryId: "backend", disconnected: true },
      ];
    },
    async repositoryCandidates() {
      return [
        { id: "frontend", role: "code" },
        { id: "backend", role: "code" },
      ];
    },
    async statuses() { return []; },
  };

  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node",
    "openspec-orch",
    "plugin",
    "disconnect",
    "sample",
    "--all",
  ]);

  assert.deepEqual(calls, [{
    pluginId: "sample",
    repositoryIds: ["frontend", "backend"],
  }]);
  assert.deepEqual(captured.lines, [
    "✓ sample → frontend — отключён",
    "✓ sample → backend — отключён",
  ]);
});

test("plugin lifecycle bulk commands preserve repeatable --repo and reject ambiguous --all", async () => {
  const calls = [];
  const captured = outputCollector();
  const lifecycleService = {
    async connectMany() { return []; },
    async disconnectMany(options) {
      calls.push(["disconnect", options]);
      return options.repositoryIds.map((repositoryId) => ({ repositoryId, disconnected: true }));
    },
    async execMany(options) {
      calls.push(["exec", options]);
      return options.repositoryIds.map((repositoryId) => ({ repositoryId, output: "" }));
    },
    async statuses() { return []; },
    async syncMany(options) {
      calls.push(["sync", options]);
      return options.repositoryIds.map((repositoryId) => ({ repositoryId, output: "" }));
    },
  };
  const repositories = ["frontend", "backend"];

  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node", "openspec-orch", "plugin", "sync", "sample",
    ...repositories.flatMap((repositoryId) => ["--repo", repositoryId]),
  ]);
  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node", "openspec-orch", "plugin", "exec", "sample",
    ...repositories.flatMap((repositoryId) => ["--repo", repositoryId]),
    "--", "status",
  ]);
  await candidate({ lifecycleService, output: captured.output }).parseAsync([
    "node", "openspec-orch", "plugin", "disconnect", "sample",
    ...repositories.flatMap((repositoryId) => ["--repo", repositoryId]),
  ]);

  assert.deepEqual(calls, [
    ["sync", { pluginId: "sample", repositoryIds: repositories }],
    ["exec", { args: ["status"], pluginId: "sample", repositoryIds: repositories }],
    ["disconnect", { pluginId: "sample", repositoryIds: repositories }],
  ]);
  await assert.rejects(
    candidate({ lifecycleService, output: captured.output }).parseAsync([
      "node", "openspec-orch", "plugin", "sync", "sample",
      "--repo", "frontend", "--all",
    ]),
    /нельзя использовать вместе/,
  );
});

test("plugin remove delegates to application facade and remains idempotent", async () => {
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
    async statuses() { return []; },
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
  assert.deepEqual(captured.lines, [
    "✓ sample — удалён",
    "• sample — не был инициализирован",
  ]);
});
