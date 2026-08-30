/** @fileoverview Проверки namespace, root policy и conflicts Plugin commands. */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";
import { definePlugin } from "@openspec-orch/plugin-sdk";
import {
  CandidateCli,
  PluginCommandRegistry,
  PluginCommandMounter,
  PluginRegistry,
} from "@openspec-orch/core";
import { loadPluginExport } from "./helpers/plugin-materializer.js";

/** Создаёт command-only Plugin. */
function commandPlugin(id, registration) {
  return definePlugin({ id, supports: [], registerCommands: registration });
}

/** Собирает Candidate CLI с переданным registry и root policy. */
function candidate(
  registry,
  rootCommands = new Map(),
  resolveContext = async () => undefined,
) {
  return new CandidateCli({
    pluginCommandMounter: new PluginCommandMounter({ registry, resolveContext, rootCommands }),
  });
}

test("CandidateCli mounts user Plugin commands only inside plugin-id namespace", async (t) => {
  const actions = [];
  const boundaries = [];
  const sample = await loadPluginExport(t, commandPlugin("sample", (commands) => {
    const builder = commands.command("hello <name>")
      .description("Приветствие")
      .action(function action(name, options, ...internal) {
        actions.push({ internal, name, options, receiver: this });
      });
    boundaries.push({ builder, commands });
  }));
  const program = candidate(new PluginRegistry([sample])).createProgram();

  assert.equal(program.commands.some((command) => command.name() === "sample"), true);
  assert.equal(program.commands.some((command) => command.name() === "hello"), false);
  await program.parseAsync(["node", "openspec-orch", "sample", "hello", "team"]);
  assert.equal(actions[0].name, "team");
  assert.deepEqual(actions[0].options, {});
  assert.equal(Object.isFrozen(actions[0].options), true);
  assert.deepEqual(actions[0].internal, []);
  assert.equal(actions[0].receiver, undefined);
  assert.equal(Object.isFrozen(boundaries[0].commands), true);
  assert.equal(Object.isFrozen(boundaries[0].builder), true);
  assert.equal("parent" in boundaries[0].commands, false);
  assert.equal("addCommand" in boundaries[0].commands, false);
  assert.equal("option" in boundaries[0].builder, true);
  assert.equal("addOption" in boundaries[0].builder, false);
});

test("Plugin command can declare nested options and request invocation context", async (t) => {
  const actions = [];
  const context = Object.freeze({ repository: Object.freeze({ id: "specs", role: "store" }) });
  const sample = await loadPluginExport(t, commandPlugin("sample", (commands) => {
    commands.command("record")
      .description("Record")
      .command("assignment <change-id>")
      .description("Record assignment")
      .option("--status <status>", "Result status", {
        choices: ["completed", "failed"],
        required: true,
      })
      .actionWithContext((received, changeId, options) => {
        actions.push({ received, changeId, options });
      });
  }));
  const program = candidate(
    new PluginRegistry([sample]),
    new Map(),
    async () => context,
  ).createProgram();

  await program.parseAsync([
    "node",
    "openspec-orch",
    "sample",
    "record",
    "assignment",
    "checkout-flow",
    "--status",
    "completed",
  ]);

  assert.equal(actions[0].received, context);
  assert.equal(actions[0].changeId, "checkout-flow");
  assert.deepEqual(actions[0].options, { status: "completed" });
  assert.equal(Object.isFrozen(actions[0].options), true);
});

test("Plugin parser errors use the Commander invalid-argument contract", async () => {
  const program = new Command().exitOverride().configureOutput({ writeErr() {} });
  const registry = new PluginCommandRegistry({
    parent: program,
    path: [],
    pluginId: "sample",
    resolveContext: async () => undefined,
  });
  registry.command("inspect").description("Inspect")
    .option("--repo <id>", "Repository", {
      parser(value, previous) {
        if (previous !== undefined) throw new Error("опцию можно указать только один раз");
        return value;
      },
    }).action(() => {});

  await assert.rejects(
    program.parseAsync([
      "node", "openspec-orch", "inspect", "--repo", "frontend", "--repo", "backend",
    ]),
    (error) => error.code === "commander.invalidArgument" && error.exitCode === 1 &&
      /опцию можно указать только один раз/.test(error.message),
  );
});

test("explicit composition policy can mount trusted Plugin commands at root", async (t) => {
  const actions = [];
  const sample = await loadPluginExport(t, commandPlugin("sample", (commands) => {
    commands.command("assign <change-id>")
      .description("Назначить Change")
      .action((changeId) => actions.push(changeId));
  }));
  const program = candidate(
    new PluginRegistry([sample]),
    new Map([["sample", ["assign"]]]),
  ).createProgram();

  assert.equal(program.commands.some((command) => command.name() === "sample"), false);
  assert.equal(program.commands.some((command) => command.name() === "assign"), true);
  await program.parseAsync(["node", "openspec-orch", "assign", "checkout-flow"]);
  assert.deepEqual(actions, ["checkout-flow"]);
});

test("Plugin namespace and root commands cannot replace Core or implicit commands", async (t) => {
  const initPlugin = await loadPluginExport(t, commandPlugin("init", (commands) => {
    commands.command("custom").description("Custom").action(() => {});
  }));
  assert.throws(
    () => candidate(new PluginRegistry([initPlugin])).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'init'/,
  );

  const rootPlugin = await loadPluginExport(t, commandPlugin("tracking", (commands) => {
    commands.command("connect").description("Conflict").action(() => {});
  }));
  assert.throws(
    () => candidate(
      new PluginRegistry([rootPlugin]),
      new Map([["tracking", ["connect"]]]),
    ).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'connect'/,
  );

  const helpPlugin = await loadPluginExport(t, commandPlugin("helper", (commands) => {
    commands.command("help").description("Conflict").action(() => {});
  }));
  assert.throws(
    () => candidate(
      new PluginRegistry([helpPlugin]),
      new Map([["helper", ["help"]]]),
    ).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'help'/,
  );

  assert.throws(
    () => candidate(new PluginRegistry([helpPlugin])).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'helper help'/,
  );
});

test("duplicate Plugin command paths fail while building CLI before any action", async (t) => {
  let actionCalls = 0;
  const duplicate = await loadPluginExport(t, commandPlugin("duplicate", (commands) => {
    commands.command("check").description("First").action(() => { actionCalls += 1; });
    commands.command("check <target>").description("Second").action(() => { actionCalls += 1; });
  }));

  assert.throws(
    () => candidate(new PluginRegistry([duplicate])).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'duplicate check'/,
  );
  assert.equal(actionCalls, 0);
});

test("recoverable Plugin command failure rolls back its namespace without blocking Core", async (t) => {
  const failures = [];
  const broken = await loadPluginExport(t, commandPlugin("broken", (commands) => {
    commands.command("partial").description("Partial").action(() => {});
    throw new Error("broken contribution");
  }));
  const mounter = new PluginCommandMounter({
    registry: new PluginRegistry([broken]),
    resolveContext: async () => undefined,
    onError: (pluginId, error) => failures.push([pluginId, error.message]),
  });

  const program = new CandidateCli({ pluginCommandMounter: mounter }).createProgram();

  assert.equal(program.commands.some((command) => command.name() === "doctor"), true);
  assert.equal(program.commands.some((command) => command.name() === "broken"), false);
  assert.deepEqual(failures, [["broken", "broken contribution"]]);
});

test("two root Plugins cannot contribute the same command path", async (t) => {
  const alpha = await loadPluginExport(t, commandPlugin("alpha", (commands) => {
    commands.command("inspect").description("Alpha").action(() => {});
  }));
  const beta = await loadPluginExport(t, commandPlugin("beta", (commands) => {
    commands.command("inspect").description("Beta").action(() => {});
  }));

  assert.throws(
    () => candidate(
      new PluginRegistry([beta, alpha]),
      new Map([
        ["alpha", ["inspect"]],
        ["beta", ["inspect"]],
      ]),
    ).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'inspect'/,
  );
});

test("root policy is an exact command contract, not only a Plugin allowlist", async (t) => {
  const extra = await loadPluginExport(t, commandPlugin("extra", (commands) => {
    commands.command("assign").description("Assign").action(() => {});
    commands.command("remove-all").description("Unexpected").action(() => {});
  }));
  assert.throws(
    () => candidate(
      new PluginRegistry([extra]),
      new Map([["extra", ["assign"]]]),
    ).createProgram(),
    /PLUGIN_COMMAND_RESERVED: extra не разрешена root command 'remove-all'/,
  );

  const missing = await loadPluginExport(t, commandPlugin("missing", (commands) => {
    commands.command("assign").description("Assign").action(() => {});
  }));
  assert.throws(
    () => candidate(
      new PluginRegistry([missing]),
      new Map([["missing", ["assign", "verify"]]]),
    ).createProgram(),
    /не зарегистрировал root commands: verify/,
  );
});

test("PluginCommandMounter validates root policy and command contribution result", async (t) => {
  const commandsOnly = await loadPluginExport(t, commandPlugin("commands", (commands) => {
    commands.command("run").description("Run").action(() => {});
  }));
  const registry = new PluginRegistry([commandsOnly]);
  assert.throws(
    () => new PluginCommandMounter({
      registry,
      resolveContext: async () => undefined,
      rootCommands: new Map([["missing", ["run"]]]),
    }),
    /root Plugin 'missing' не загружен/,
  );

  const valid = commandsOnly.plugin;
  const invalid = Object.freeze({
    id: valid.id,
    supports: valid.supports,
    supportsRole: valid.supportsRole.bind(valid),
    assertSupports: valid.assertSupports.bind(valid),
    hasRepositoryContribution: valid.hasRepositoryContribution.bind(valid),
    connect: valid.connect.bind(valid),
    status: valid.status.bind(valid),
    canSync: valid.canSync.bind(valid),
    sync: valid.sync.bind(valid),
    canExec: valid.canExec.bind(valid),
    exec: valid.exec.bind(valid),
    hasExtensionContribution: valid.hasExtensionContribution.bind(valid),
    extensions: valid.extensions.bind(valid),
    hasCommandContribution: () => "yes",
    registerCommands: valid.registerCommands.bind(valid),
  });
  const invalidLoaded = await loadPluginExport(t, invalid);
  assert.throws(
    () => candidate(new PluginRegistry([invalidLoaded])).createProgram(),
    /hasCommandContribution должен вернуть boolean/,
  );
});
