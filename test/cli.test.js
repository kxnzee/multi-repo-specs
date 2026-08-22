/** @fileoverview Проверка декларативного контракта OpenSpec Orchestrator CLI. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildConnectHint } from "../src/cli/commands/init.js";
import { formatStatusJson } from "../src/cli/commands/status.js";
import { createProgram } from "../src/cli/program.js";
import { parseNativePluginArguments } from "../src/internal/plugin/router.js";
import { assertNodeVersion } from "../src/internal/shared/runtime.js";
import { reportProgress, withProgress } from "../src/cli/progress.js";

/**
 * Разбирает одну команду без запуска production-сценария.
 *
 * @param {string[]} args Аргументы начиная с имени команды.
 * @returns {Promise<{name: string, options: Record<string, unknown>} | undefined>} Нормализованный вызов.
 */
async function parseCommand(args) {
  let invocation;
  const handler = (name) => async (options) => {
    invocation = { name, options };
  };
  const program = createProgram({
    init: handler("init"),
    connect: handler("connect"),
    pluginRegister: handler("pluginRegister"),
    pluginInit: handler("pluginInit"),
    pluginConnect: handler("pluginConnect"),
    pluginStatus: handler("pluginStatus"),
    pluginSync: handler("pluginSync"),
    pluginDisconnect: handler("pluginDisconnect"),
    pluginRemove: handler("pluginRemove"),
    repositoryStatus: handler("repositoryStatus"),
    assign: handler("assign"),
    status: handler("status"),
    recordAssignment: handler("recordAssignment"),
    verify: handler("verify"),
    recordVerification: handler("recordVerification"),
  });
  for (const command of [program, ...program.commands]) {
    command.configureOutput({ writeOut() {}, writeErr() {} });
    for (const subcommand of command.commands) subcommand.configureOutput({ writeOut() {}, writeErr() {} });
  }
  await program.parseAsync(args, { from: "user" });
  return invocation;
}

test("enforces the Node runtime dependency boundary", () => {
  const entrypoint = pathToFileURL(path.resolve("src/bin/openspec-orch.js")).href;
  const unsupportedScript = `
    Object.defineProperty(process.versions, "node", { value: "20.18.0" });
    await import(${JSON.stringify(entrypoint)});
  `;
  const unsupported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", unsupportedScript],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /требует Node\.js 20\.19\.0 или новее/);

  const supportedScript = `
    Object.defineProperty(process.versions, "node", { value: "20.19.0" });
    process.argv = [process.execPath, ${JSON.stringify(path.resolve("src/bin/openspec-orch.js"))}, "--help"];
    await import(${JSON.stringify(entrypoint)});
  `;
  const supported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", supportedScript],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(supported.status, 0, supported.stderr);
  assert.match(supported.stdout, /^Usage: openspec-orch/m);
});

test("shared runtime validation accepts the exact boundary and rejects malformed versions", () => {
  assert.doesNotThrow(() => assertNodeVersion("20.19.0"));
  assert.doesNotThrow(() => assertNodeVersion("22.0.0"));
  assert.throws(() => assertNodeVersion("20.18.99"), /20\.19\.0/);
  assert.throws(() => assertNodeVersion("20.19.invalid"), /20\.19\.0/);
});

test("public binary exposes generated help", () => {
  const result = spawnSync(process.execPath, ["src/bin/openspec-orch.js", "--help"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^Usage: openspec-orch/m);
  for (const command of ["init", "connect", "plugin", "repository", "assign", "status", "record", "verify"]) {
    assert.match(result.stdout, new RegExp(`^  ${command}`, "m"));
  }
});

test("init hint follows the workspace layout accepted by connect", () => {
  assert.equal(
    buildConnectHint("/work/payments-specs", "payments-specs"),
    "Далее: выполните openspec-orch connect",
  );
  assert.equal(
    buildConnectHint("/work/central-store", "payments-specs"),
    "Далее: выполните openspec-orch connect --workspace \"/work\"",
  );
});

test("every subcommand exposes generated help without running its action", () => {
  for (const command of ["init", "connect", "plugin", "repository", "assign", "status", "record", "verify"]) {
    const result = spawnSync(
      process.execPath,
      ["src/bin/openspec-orch.js", command, "--help"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Usage: openspec-orch ${command}`, "m"));
  }
});

test("repository status --help is exposed without running its action", () => {
  const result = spawnSync(
    process.execPath,
    ["src/bin/openspec-orch.js", "repository", "status", "--help"],
    { cwd: path.resolve("."), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: openspec-orch repository status/m);
});

test("init command normalizes positional and repeated repository options", async () => {
  assert.deepEqual(
    await parseCommand([
      "init",
      "project",
      "--store=specs",
      "--agent=test-agent",
      "--repo=api=https://example.test/api.git#main",
      "--template=./team-template",
      "--no-strict",
    ]),
    {
      name: "init",
      options: {
        target: "project",
        storeId: "specs",
        agentId: "test-agent",
        templateRoot: "./team-template",
        noStrict: true,
        repositories: [{
          id: "api",
          role: "code",
          remote: "https://example.test/api.git",
          defaultBranch: "main",
        }],
      },
    },
  );
});

test("init command accepts split options and applies stable defaults", async () => {
  assert.deepEqual(
    await parseCommand(["init", "--store", "specs", "--agent", "test-agent"]),
    {
      name: "init",
      options: {
        target: ".",
        storeId: "specs",
        agentId: "test-agent",
        templateRoot: undefined,
        repositories: [],
        noStrict: false,
      },
    },
  );
});

test("connect command normalizes shared options", async () => {
  assert.deepEqual(
    await parseCommand(["connect", "--workspace=/tmp/work", "--no-strict"]),
    { name: "connect", options: { workspace: "/tmp/work", noStrict: true } },
  );
});

test("plugin lifecycle commands normalize interactive and non-interactive options", async () => {
  assert.deepEqual(
    await parseCommand([
      "plugin",
      "register",
      "dependency-audit",
      "./team-plugins/dependency-audit",
      "--name=Dependency Audit",
      "--support=store",
      "--support=code",
    ]),
    {
      name: "pluginRegister",
      options: {
        pluginId: "dependency-audit",
        target: "./team-plugins/dependency-audit",
        name: "Dependency Audit",
        supports: ["store", "code"],
      },
    },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "init", "--plugin=dependency-audit", "--from=./team-plugins"]),
    {
      name: "pluginInit",
      options: { pluginIds: ["dependency-audit"], sourceRoots: ["./team-plugins"], all: false },
    },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "connect", "dependency-audit", "--repo=frontend", "--repo=backend"]),
    {
      name: "pluginConnect",
      options: { pluginId: "dependency-audit", repositoryIds: ["frontend", "backend"] },
    },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "status", "--plugin=dependency-audit", "--repo=frontend", "--json"]),
    {
      name: "pluginStatus",
      options: { pluginId: "dependency-audit", repositoryId: "frontend", json: true },
    },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "sync", "dependency-audit", "--repo=frontend"]),
    { name: "pluginSync", options: { pluginId: "dependency-audit", repositoryId: "frontend" } },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "disconnect", "dependency-audit", "--repo=frontend"]),
    { name: "pluginDisconnect", options: { pluginId: "dependency-audit", repositoryId: "frontend" } },
  );
  assert.deepEqual(
    await parseCommand(["plugin", "remove", "dependency-audit"]),
    { name: "pluginRemove", options: { pluginId: "dependency-audit" } },
  );
});

test("native Plugin routing removes only the required repository selector", () => {
  assert.deepEqual(
    parseNativePluginArguments(["--repository=frontend", "explore", "authentication flow"]),
    { repositoryId: "frontend", pluginArgs: ["explore", "authentication flow"] },
  );
  assert.deepEqual(
    parseNativePluginArguments(["explore", "--repository", "frontend", "--json"]),
    { repositoryId: "frontend", pluginArgs: ["explore", "--json"] },
  );
  assert.throws(() => parseNativePluginArguments(["explore"]), /--repository/);
  assert.throws(
    () => parseNativePluginArguments(["--repository=frontend", "--repository=backend"]),
    /одно значение/,
  );
});

test("repository status collects repeated --repo filters", async () => {
  assert.deepEqual(
    await parseCommand(["repository", "status"]),
    { name: "repositoryStatus", options: { repositoryIds: [] } },
  );
  assert.deepEqual(
    await parseCommand(["repository", "status", "--repo=frontend", "--repo=backend"]),
    { name: "repositoryStatus", options: { repositoryIds: ["frontend", "backend"] } },
  );
});

test("assign command requires at least one --repo and collects the change-id", async () => {
  assert.deepEqual(
    await parseCommand(["assign", "checkout-flow", "--repo=frontend", "--repo=backend"]),
    {
      name: "assign",
      options: { changeId: "checkout-flow", repositoryIds: ["frontend", "backend"] },
    },
  );
  await assert.rejects(parseCommand(["assign", "checkout-flow"]));
  await assert.rejects(parseCommand(["assign"]));
});

test("status command requires the change-id positional argument", async () => {
  assert.deepEqual(
    await parseCommand(["status", "checkout-flow"]),
    { name: "status", options: { changeId: "checkout-flow", json: false } },
  );
  assert.deepEqual(
    await parseCommand(["status", "checkout-flow", "--json"]),
    { name: "status", options: { changeId: "checkout-flow", json: true } },
  );
  await assert.rejects(parseCommand(["status"]));
});

test("status JSON exposes the current repository without changing Cycle semantics", () => {
  const payload = formatStatusJson({
    changeId: "checkout-flow",
    cycle: {
      cycleId: "cycle-11111111-1111-4111-8111-111111111111",
      planningRevision: "a".repeat(40),
      repositories: ["frontend", "backend"],
    },
    committed: true,
    repositories: [
      {
        repositoryId: "frontend",
        state: "missing",
        receipt: null,
        commitAvailable: null,
        head: null,
        headMatches: null,
      },
    ],
    snapshot: null,
    verification: null,
    nextAction: "записать результаты",
  }, { id: "frontend", role: "code", path: "/work/src/frontend" });

  assert.equal(payload.change_id, "checkout-flow");
  assert.equal(payload.current_repository.repository_id, "frontend");
  assert.equal(payload.current_repository.in_cycle, true);
  assert.equal(payload.results[0].status, "missing");
  assert.equal(payload.planning_revision, "a".repeat(40));
});

test("record assignment accepts only the v1 Result Receipt flags", async () => {
  assert.deepEqual(
    await parseCommand([
      "record",
      "assignment",
      "checkout-flow",
      "--repo=frontend",
      `--commit=${"a".repeat(40)}`,
      "--status=completed",
      "--source=human",
      "--note=ready",
    ]),
    {
      name: "recordAssignment",
      options: {
        changeId: "checkout-flow",
        repositoryId: "frontend",
        implementationRevision: "a".repeat(40),
        status: "completed",
        source: "human",
        note: "ready",
      },
    },
  );
});

test("verify and record verification do not accept user-supplied Cycle or Snapshot IDs", async () => {
  assert.deepEqual(
    await parseCommand(["verify", "checkout-flow"]),
    { name: "verify", options: { changeId: "checkout-flow" } },
  );
  assert.deepEqual(
    await parseCommand([
      "record",
      "verification",
      "checkout-flow",
      "--result=pass",
      "--source=agent",
    ]),
    {
      name: "recordVerification",
      options: {
        changeId: "checkout-flow",
        result: "pass",
        source: "agent",
        note: undefined,
      },
    },
  );
  await assert.rejects(parseCommand(["verify", "checkout-flow", "--snapshot", "manual"]));
});

test("invalid CLI invocation exits with code 2", () => {
  const result = spawnSync(process.execPath, ["src/bin/openspec-orch.js", "assign"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
});

test("Commander rejects missing, duplicate and unknown options", async () => {
  await assert.rejects(parseCommand(["init", "--agent=test-agent"]));
  await assert.rejects(parseCommand(["init", "--store=specs"]));
  await assert.rejects(parseCommand([
    "init",
    "--store=specs",
    "--store=other",
    "--agent=test-agent",
  ]));
  await assert.rejects(parseCommand([
    "init",
    "--store=specs",
    "--agent=test-agent",
    "--unknown",
  ]));
  await assert.rejects(parseCommand(["connect", "--workspace", "--help"]));
});

test("reportProgress writes one event to the selected output", () => {
  let written = "";
  reportProgress("progress-event", "running", {
    write(chunk) {
      written += chunk;
    },
  });
  assert.equal(written, "… progress-event\n");
});

test("withProgress reports success and failure without changing operation results", async () => {
  let written = "";
  const output = { write: (chunk) => { written += chunk; } };
  assert.equal(
    await withProgress(
      { start: "start", success: "done", failure: "failed" },
      async () => "result",
      output,
    ),
    "result",
  );
  await assert.rejects(withProgress(
    { start: "retry", success: "done", failure: "failed" },
    async () => { throw new Error("operation error"); },
    output,
  ));
  assert.equal(written, "… start\n✓ done\n… retry\n✗ failed\n");
});
