/** @fileoverview Проверки namespace, root policy и conflicts Plugin commands. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { definePlugin } from "@openspec-orch/plugin-sdk";
import {
  CandidateCli,
  PluginCommandMounter,
  PluginLoader,
  PluginRegistry,
} from "@openspec-orch/core";

/** Загружает Plugin definition через реальную package boundary. */
async function loadPlugin(t, plugin) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-command-plugin-"));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const manifest = {
    name: `@test/openspec-orch-plugin-${plugin.id}`,
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
    openspecOrchestrator: { apiVersion: 1, plugin: "./index.js" },
    peerDependencies: { "@openspec-orch/plugin-sdk": "*" },
  };
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(packageRoot, "index.js"), "export default {};\n");
  return new PluginLoader(async () => ({ default: plugin })).load({
    packageRoot: await fs.realpath(packageRoot),
    pluginId: plugin.id,
  });
}

/** Создаёт command-only Plugin. */
function commandPlugin(id, registration) {
  return definePlugin({ id, supports: [], registerCommands: registration });
}

/** Собирает Candidate CLI с переданным registry и root policy. */
function candidate(registry, rootCommands = new Map()) {
  return new CandidateCli({
    pluginCommandMounter: new PluginCommandMounter({ registry, rootCommands }),
  });
}

test("CandidateCli mounts user Plugin commands only inside plugin-id namespace", async (t) => {
  const actions = [];
  const boundaries = [];
  const sample = await loadPlugin(t, commandPlugin("sample", (commands) => {
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
  assert.equal("option" in boundaries[0].builder, false);
});

test("explicit composition policy can mount trusted Plugin commands at root", async (t) => {
  const actions = [];
  const tracking = await loadPlugin(t, commandPlugin("change-tracking", (commands) => {
    commands.command("assign <change-id>")
      .description("Назначить Change")
      .action((changeId) => actions.push(changeId));
  }));
  const program = candidate(
    new PluginRegistry([tracking]),
    new Map([["change-tracking", ["assign"]]]),
  ).createProgram();

  assert.equal(program.commands.some((command) => command.name() === "change-tracking"), false);
  assert.equal(program.commands.some((command) => command.name() === "assign"), true);
  await program.parseAsync(["node", "openspec-orch", "assign", "checkout-flow"]);
  assert.deepEqual(actions, ["checkout-flow"]);
});

test("Plugin namespace and root commands cannot replace Core or implicit commands", async (t) => {
  const initPlugin = await loadPlugin(t, commandPlugin("init", (commands) => {
    commands.command("custom").description("Custom").action(() => {});
  }));
  assert.throws(
    () => candidate(new PluginRegistry([initPlugin])).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'init'/,
  );

  const rootPlugin = await loadPlugin(t, commandPlugin("tracking", (commands) => {
    commands.command("connect").description("Conflict").action(() => {});
  }));
  assert.throws(
    () => candidate(
      new PluginRegistry([rootPlugin]),
      new Map([["tracking", ["connect"]]]),
    ).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'connect'/,
  );

  const helpPlugin = await loadPlugin(t, commandPlugin("helper", (commands) => {
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
  const duplicate = await loadPlugin(t, commandPlugin("duplicate", (commands) => {
    commands.command("check").description("First").action(() => { actionCalls += 1; });
    commands.command("check <target>").description("Second").action(() => { actionCalls += 1; });
  }));

  assert.throws(
    () => candidate(new PluginRegistry([duplicate])).createProgram(),
    /PLUGIN_COMMAND_CONFLICT: command path 'duplicate check'/,
  );
  assert.equal(actionCalls, 0);
});

test("two root Plugins cannot contribute the same command path", async (t) => {
  const alpha = await loadPlugin(t, commandPlugin("alpha", (commands) => {
    commands.command("inspect").description("Alpha").action(() => {});
  }));
  const beta = await loadPlugin(t, commandPlugin("beta", (commands) => {
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
  const extra = await loadPlugin(t, commandPlugin("extra", (commands) => {
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

  const missing = await loadPlugin(t, commandPlugin("missing", (commands) => {
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
  const commandsOnly = await loadPlugin(t, commandPlugin("commands", (commands) => {
    commands.command("run").description("Run").action(() => {});
  }));
  const registry = new PluginRegistry([commandsOnly]);
  assert.throws(
    () => new PluginCommandMounter({
      registry,
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
    hasAgentContribution: valid.hasAgentContribution.bind(valid),
    integrateAgent: valid.integrateAgent.bind(valid),
    hasCommandContribution: () => "yes",
    registerCommands: valid.registerCommands.bind(valid),
  });
  const invalidLoaded = await loadPlugin(t, invalid);
  assert.throws(
    () => candidate(new PluginRegistry([invalidLoaded])).createProgram(),
    /hasCommandContribution должен вернуть boolean/,
  );
});
