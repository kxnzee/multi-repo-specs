/** @fileoverview Проверки минимального Plugin SDK и его внешнего test kit. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";

import {
  CliProgressRenderer,
  collectValues,
  COMMAND_CONTEXT,
  COMMAND_SCOPE,
  createCliProgress,
  defineExtension,
  definePlugin,
  Extension,
  Plugin,
  PluginPackage,
  PLUGIN_API_VERSION,
  PLUGIN_PATTERNS,
  REPOSITORY_ROLE,
  singleValue,
} from "@openspec-orch/plugin-sdk";
import {
  assertPluginContract,
  assertPluginPackageManifest,
  PluginContract,
  testPluginContract,
} from "@openspec-orch/plugin-sdk/testing";

test("CLI progress writes before completion and preserves redirected output as lines", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  let source = "";
  const progress = createCliProgress({
    output: { isTTY: false, write(value) { source += value; } },
  });

  const running = progress.run("Проверка repositories...", () => pending, {
    success: "Repositories проверены",
  });
  assert.equal(source, "… Проверка repositories...\n");
  resolve("ready");

  assert.equal(await running, "ready");
  assert.equal(source, "… Проверка repositories...\n✓ Repositories проверены\n");
  assert.equal(progress.active, false);
});

test("CLI progress renders a TTY spinner and reports failures without swallowing them", async () => {
  let source = "";
  const progress = new CliProgressRenderer({
    intervalMs: 60_000,
    output: { isTTY: true, write(value) { source += value; } },
  });

  await assert.rejects(
    progress.run("Синхронизация...", async () => { throw new Error("failed"); }),
    /failed/,
  );
  assert.match(source, /⠋ Синхронизация/);
  assert.match(source, /✗ Синхронизация\.\.\.: ошибка/);
  assert.equal(progress.active, false);
});

const SAMPLE_ROOT = new URL("../../../test-fixtures/plugin-sdk/sample-plugin/", import.meta.url);
const SAMPLE_MANIFEST = JSON.parse(await fs.readFile(new URL("package.json", SAMPLE_ROOT), "utf8"));
const { default: SAMPLE_PLUGIN } = await import(new URL("index.js", SAMPLE_ROOT));

test("SDK exposes one immutable source for roles, scopes, patterns and CLI values", () => {
  assert.deepEqual(REPOSITORY_ROLE, { code: "code", store: "store" });
  assert.deepEqual(COMMAND_SCOPE, { current: "current", store: "store" });
  assert.equal(COMMAND_CONTEXT.defaultScope, COMMAND_SCOPE.current);
  assert.deepEqual(COMMAND_CONTEXT.scopes, Object.values(COMMAND_SCOPE));
  assert.equal(PLUGIN_PATTERNS.id.test("sample-plugin"), true);
  assert.equal(PLUGIN_PATTERNS.id.test("ChangeTracking"), false);
  assert.equal(PLUGIN_PATTERNS.exactSemanticVersion.test("1.2.3"), true);
  assert.equal(PLUGIN_PATTERNS.exactSemanticVersion.test("^1.2.3"), false);
  assert.equal(singleValue("store"), "store");
  assert.deepEqual(collectValues("store", ["code"]), ["code", "store"]);
  assert.equal(Object.isFrozen(REPOSITORY_ROLE), true);
  assert.equal(Object.isFrozen(COMMAND_CONTEXT.scopes), true);
});

testPluginContract({ plugin: SAMPLE_PLUGIN, packageManifest: SAMPLE_MANIFEST });

test("definePlugin returns an immutable domain model without running contributions", () => {
  const calls = [];
  const supports = ["code"];
  const plugin = definePlugin({
    id: "dependency-audit",
    supports,
    repository: {
      connect(context) { calls.push(["connect", context]); },
      status(context) { calls.push(["status", context]); },
      exec(context, args) { calls.push(["exec", context, args]); },
    },
    registerCommands() { calls.push(["register"]); },
  });
  supports.push("store");

  assert.equal(plugin instanceof Plugin, true);
  assert.deepEqual(calls, []);
  assert.deepEqual(plugin.supports, ["code"]);
  assert.equal(Object.isFrozen(plugin), true);
  assert.equal(Object.isFrozen(plugin.supports), true);
  assert.equal(plugin.hasRepositoryContribution(), true);
  assert.equal(plugin.supportsRole("code"), true);
  plugin.assertSupports({ id: "frontend", role: "code" });
  assert.throws(
    () => plugin.assertSupports({ id: "specs", role: "store" }),
    /PLUGIN_SCOPE_UNSUPPORTED/,
  );

  const context = Object.freeze({ repository: { id: "frontend", role: "code" } });
  plugin.connect(context);
  plugin.status(context);
  const nativeArgs = ["status", "--json"];
  plugin.exec(context, nativeArgs);
  nativeArgs.push("--verbose");
  assert.deepEqual(calls, [
    ["connect", context],
    ["status", context],
    ["register"],
    ["exec", context, ["status", "--json"]],
  ]);
  assert.equal(Object.isFrozen(calls[3][2]), true);
  assert.equal(plugin.canSync(), false);
  assert.throws(() => plugin.sync(context), /PLUGIN_SYNC_UNSUPPORTED/);
  assert.equal(plugin.canExec(), true);
  assert.throws(() => plugin.exec(context, []), /PLUGIN_EXEC_INVALID/);
});

test("Plugin exposes immutable Extension contributions as data", () => {
  let calls = 0;
  const plugin = definePlugin({
    id: "codegraph",
    supports: ["code"],
    repository: {
      connect() {},
      status() { return { state: "ready" }; },
    },
    extensions(context) {
      calls += 1;
      return [defineExtension({
        id: "agent",
        root: "./extension",
        target: context.repository,
      })];
    },
  });

  assert.equal(calls, 0);
  assert.equal(plugin.hasExtensionContribution(), true);

  const [extension] = plugin.extensions({ repository: { id: "frontend", role: "code" } });
  assert.equal(calls, 1);
  assert.equal(extension instanceof Extension, true);
  assert.equal(extension.id, "agent");
  assert.equal(extension.root, "./extension");
  assert.deepEqual(extension.target, { id: "frontend", role: "code" });
  assert.equal(Object.isFrozen(extension), true);
  assert.equal(Object.isFrozen(extension.target), true);

  assert.throws(
    () => defineExtension({
      id: "agent",
      root: "/tmp/extension",
      target: { id: "frontend", role: "code" },
    }),
    /EXTENSION_DEFINITION_INVALID/,
  );
  assert.throws(
    () => defineExtension({
      id: "agent",
      root: "./extension",
      target: { id: "frontend", role: "code" },
      connect() {},
    }),
    /неизвестное поле 'connect'/,
  );
});

test("Plugin exposes immutable Agent tools and response overlays as data", async () => {
  const plugin = definePlugin({
    id: "sample-agent",
    agent: {
      requireBinding: true,
      create: (context) => Object.freeze({ context }),
      enhance: ({ result }) => Object.freeze({ ...result, optional: true }),
      tools: [{
        name: "sample_read",
        description: "Read sample data.",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: (application) => application.context.repository.id,
      }],
    },
  });
  const contribution = plugin.agentContribution();

  assert.equal(plugin.hasAgentContribution(), true);
  assert.equal(contribution.requireBinding, true);
  assert.equal(Object.isFrozen(contribution.tools), true);
  assert.equal(Object.isFrozen(contribution.tools[0].definition.inputSchema), true);
  const application = contribution.create({ repository: { id: "specs" } });
  assert.equal(await contribution.tools[0].execute(application, {}), "specs");
  assert.deepEqual(await contribution.enhance({ result: { state: "ready" } }), {
    state: "ready",
    optional: true,
  });
});

test("definePlugin rejects invalid definitions without instanceof coupling", () => {
  assert.throws(() => definePlugin(null), /PLUGIN_DEFINITION_INVALID/);
  assert.throws(() => definePlugin({ id: "Demo", supports: [], registerCommands() {} }), /kebab-case/);
  assert.throws(
    () => definePlugin({ id: "demo", supports: ["code", "code"], repository: { connect() {}, status() {} } }),
    /повторяющуюся role/,
  );
  assert.throws(
    () => definePlugin({ id: "demo", supports: ["code"], registerCommands() {} }),
    /supports разрешён только вместе с repository/,
  );
  assert.throws(
    () => definePlugin({ id: "demo", supports: ["code"], repository: { connect() {} } }),
    /repository.status/,
  );
  assert.throws(
    () => definePlugin({
      id: "demo",
      supports: ["code"],
      repository: { connect() {}, status() {}, exec: true },
    }),
    /repository.exec/,
  );
  assert.throws(
    () => definePlugin({ id: "demo", supports: [], unexpected: true, registerCommands() {} }),
    /неизвестное поле/,
  );
});

test("Package manifest contract replaces plugin.yaml with one ESM entrypoint", () => {
  assert.equal(PLUGIN_API_VERSION, 1);
  const pluginPackage = new PluginPackage(SAMPLE_MANIFEST);
  assert.equal(pluginPackage.name, "@test/openspec-orch-plugin-sample");
  assert.equal(pluginPackage.version, "1.0.0");
  assert.equal(pluginPackage.entrypoint, "./index.js");
  assert.deepEqual(assertPluginPackageManifest(SAMPLE_MANIFEST), {
    name: "@test/openspec-orch-plugin-sample",
    version: "1.0.0",
    plugin: "./index.js",
  });
  assert.throws(
    () => assertPluginPackageManifest({
      ...SAMPLE_MANIFEST,
      openspecOrchestrator: { apiVersion: 1, plugin: "./index.js", unexpected: true },
    }),
    /должен содержать apiVersion и plugin/,
  );
  assert.throws(
    () => assertPluginPackageManifest({
      ...SAMPLE_MANIFEST,
      openspecOrchestrator: {
        apiVersion: 1,
        manifest: "plugin.yaml",
        entrypoint: "bin/plugin.js",
      },
    }),
    /должен содержать apiVersion и plugin/,
  );
  assert.throws(
    () => assertPluginPackageManifest({ ...SAMPLE_MANIFEST, peerDependencies: {} }),
    /должен объявить @openspec-orch\/plugin-sdk/,
  );
});

test("contract test kit validates command registration without running actions", () => {
  let actionCalls = 0;
  const plugin = definePlugin({
    id: "commands-only",
    registerCommands(commands) {
      commands.command("hello")
        .description("Hello")
        .action(() => { actionCalls += 1; });
    },
  });

  assert.deepEqual(
    assertPluginContract({ plugin, packageManifest: SAMPLE_MANIFEST }),
    { id: "commands-only", commands: ["hello"] },
  );
  const contract = new PluginContract({ plugin, packageManifest: SAMPLE_MANIFEST });
  assert.equal(contract instanceof PluginContract, true);
  assert.equal(contract.package instanceof PluginPackage, true);
  assert.equal(actionCalls, 0);
  assert.throws(
    () => assertPluginContract({
      plugin: definePlugin({
        id: "duplicate-commands",
        supports: [],
        registerCommands(commands) {
          commands.command("hello");
          commands.command("hello <target>");
        },
      }),
      packageManifest: SAMPLE_MANIFEST,
    }),
    /повторяющаяся Command/,
  );
});

test("Plugin exec defaults to registered command grammar without Repository boilerplate", async () => {
  const calls = [];
  const plugin = definePlugin({
    id: "command-exec",
    registerCommands(commands) {
      commands.command("inspect <target>")
        .description("Inspect target")
        .option("--format <format>", "Output format", { choices: ["text", "json"] })
        .option("--tag <tag>", "Repeatable tag", {
          parser: (value, previous = []) => [...previous, value],
        })
        .actionWithContext((context, target, options) => {
          calls.push({ context, options, target });
        });
    },
  });
  const context = Object.freeze({
    repository: Object.freeze({ id: "frontend", role: "code" }),
  });
  const args = [
    "inspect", "PluginHost", "--format=json", "--tag", "core", "--tag", "sdk",
  ];

  assert.equal(plugin.canExec(), true);
  await plugin.exec(context, args);
  args.push("--verbose");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].context, context);
  assert.equal(calls[0].target, "PluginHost");
  assert.deepEqual(calls[0].options, { format: "json", tag: ["core", "sdk"] });
  assert.equal(Object.isFrozen(calls[0].options), true);

  await assert.rejects(
    plugin.exec(context, ["inspect", "PluginHost", "--format", "--tag", "core"]),
    /--format требует значение/u,
  );
  assert.equal(calls.length, 1);
});

test("registered Store commands reject exec through a Code Repository instance", async () => {
  const plugin = definePlugin({
    id: "store-command",
    supports: ["store", "code"],
    repository: {
      connect() {},
      status() { return { state: "ready" }; },
    },
    registerCommands(commands) {
      commands.command("inspect")
        .description("Inspect Store")
        .actionWithContext(() => {}, { scope: "store" });
    },
  });

  await assert.rejects(plugin.exec(Object.freeze({
    repository: Object.freeze({ id: "frontend", role: "code" }),
  }), ["inspect"]), /PLUGIN_EXEC_SCOPE_MISMATCH.*Store instance/);
});

test("contract test kit rejects invalid nested command actions and option metadata", () => {
  const contract = (registerCommands) => assertPluginContract({
    plugin: definePlugin({ id: "invalid-commands", supports: [], registerCommands }),
    packageManifest: SAMPLE_MANIFEST,
  });

  assert.throws(
    () => contract((commands) => commands.command("missing-action").description("Missing")),
    /не имеет action/,
  );
  assert.throws(
    () => contract((commands) => commands.command("parent").description("Parent")
      .command("child").description("Child")),
    /parent child.*не имеет action/,
  );
  assert.throws(
    () => contract((commands) => commands.command("bad-option").description("Bad")
      .option("json", "Bad flags").action(() => {})),
    /неверную option/,
  );
  assert.throws(
    () => contract((commands) => commands.command("bad-config").description("Bad")
      .option("--state <state>", "State", { choices: [], required: "yes" })
      .action(() => {})),
    /неверную option/,
  );
  assert.throws(
    () => contract((commands) => commands.command("bad-scope").description("Bad")
      .actionWithContext(() => {}, { scope: "project" })),
    /неверный context scope/,
  );
});

test("contract validation uses the public Plugin API instead of instanceof", () => {
  const plugin = SAMPLE_PLUGIN;
  const externalPlugin = Object.freeze({
    id: plugin.id,
    supports: plugin.supports,
    supportsRole: plugin.supportsRole.bind(plugin),
    assertSupports: plugin.assertSupports.bind(plugin),
    hasRepositoryContribution: plugin.hasRepositoryContribution.bind(plugin),
    connect: plugin.connect.bind(plugin),
    status: plugin.status.bind(plugin),
    canSync: plugin.canSync.bind(plugin),
    sync: plugin.sync.bind(plugin),
    canExec: plugin.canExec.bind(plugin),
    exec: plugin.exec.bind(plugin),
    hasAgentContribution: plugin.hasAgentContribution.bind(plugin),
    agentContribution: plugin.agentContribution.bind(plugin),
    hasExtensionContribution: plugin.hasExtensionContribution.bind(plugin),
    extensions: plugin.extensions.bind(plugin),
    hasCommandContribution: plugin.hasCommandContribution.bind(plugin),
    registerCommands: plugin.registerCommands.bind(plugin),
  });

  assert.deepEqual(
    assertPluginContract({ plugin: externalPlugin, packageManifest: SAMPLE_MANIFEST }),
    { id: "sample", commands: ["hello"] },
  );
  const withoutExec = Object.freeze(Object.fromEntries(
    Object.entries(externalPlugin).filter(([method]) => method !== "exec"),
  ));
  assert.throws(
    () => assertPluginContract({
      plugin: withoutExec,
      packageManifest: SAMPLE_MANIFEST,
    }),
    /не предоставляет метод exec/,
  );
});
