/** @fileoverview Проверки неизменной CLI-грамматики Plugin lifecycle. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateCli,
  createProject,
  PluginLifecycleCommands,
} from "@openspec-orch/core";

/** Создаёт output boundary без подмены global console. */
function outputCollector() {
  const lines = [];
  return { lines, output: { log: (value) => lines.push(value) } };
}

/** Создаёт Project registry для интерактивного repository checkbox. */
function promptProject() {
  return createProject({
    version: 2,
    strict: true,
    agents: ["codex"],
    plugins: ["sample"],
    extensions: {},
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
function candidate({ checkboxPrompt, lifecycleService, output, stdin, stdout, storeProjectService }) {
  const pluginLifecycleCommands = new PluginLifecycleCommands({
    checkboxPrompt,
    lifecycleService,
    output,
    stdin,
    stdout,
    storeProjectService,
  });
  return new CandidateCli({ pluginLifecycleCommands }).createProgram();
}

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
