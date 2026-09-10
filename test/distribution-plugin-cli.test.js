/** @fileoverview Distribution composition smoke for bundled Plugin packages. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { execa } from "execa";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parse } from "yaml";

import { configuration } from "@openspec-orch/core";

import {
  CLI_PATH, MCP_PATH, runCli, writeFakeQwen, commitAll, distributionFixture,
} from "../test-support/distribution.js";

test("candidate distribution bootstraps the Agent gateway once in user scope", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-agent-bootstrap-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fakeBin = path.join(root, "bin");
  const nativeLog = path.join(root, "qwen-native.jsonl");
  await fs.mkdir(fakeBin);
  await writeFakeQwen(fakeBin);
  const originalPath = process.env.PATH;
  const originalNativeLog = process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG = nativeLog;
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalNativeLog === undefined) delete process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;
    else process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG = originalNativeLog;
  });

  const setup = await runCli(root, "agent", "setup", "--agent", "qwen");
  const status = await runCli(root, "agent", "status", "--agent", "qwen");
  const repeated = await runCli(root, "agent", "setup", "--agent", "qwen");
  const removed = await runCli(root, "agent", "remove", "--agent", "qwen");

  assert.match(setup.stdout, /Scope: user/u);
  assert.match(status.stdout, /Status: ready/u);
  assert.match(repeated.stdout, /Status: ready/u);
  assert.match(removed.stdout, /Status: removed/u);
  const calls = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).args);
  assert.deepEqual(calls, [
    ["--version"],
    ["extensions", "list"],
    ["extensions", "list"],
    [
      "extensions", "install",
      `${await fs.realpath(path.join(
        path.dirname(CLI_PATH),
        "../extensions/orchestrator-agent",
      ))}:orchestrator-agent`,
      "--scope", "user", "--consent",
    ],
    ["extensions", "list"],
    ["extensions", "list"],
    ["extensions", "list"],
    ["--version"],
    ["extensions", "list"],
    ["extensions", "uninstall", "orchestrator-agent"],
  ]);
});

test("candidate distribution exposes every Plugin through plugin exec", async (t) => {
  const { codeRoot, nativeLog, storeRoot } = await distributionFixture(
    t,
    "openspec-orch-distribution-cli-",
  );

  const scaffoldRoot = path.join(path.dirname(storeRoot), "scaffolded-plugin");
  await runCli(storeRoot, "plugin", "register", "sample-native", scaffoldRoot,
    "--profile", "native", "--extension");
  for (const relative of [".claude-plugin/plugin.json", "qwen-extension.json", "gigacode-extension.json"]) {
    const manifest = JSON.parse(await fs.readFile(path.join(scaffoldRoot, "extension", relative), "utf8"));
    assert.equal(manifest.name, "sample-native-agent");
  }
  const hook = await execa(process.execPath, [path.join(scaffoldRoot, "extension/hooks/session-start.js")]);
  assert.equal(hook.stdout.trim(), (await fs.readFile(
    path.join(scaffoldRoot, "extension/agent-instructions.md"), "utf8",
  )).trim());

  const graphSeed = path.join(storeRoot, "openspec/graph.yaml");
  await assert.rejects(fs.access(graphSeed), { code: "ENOENT" });
  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(storeRoot, "plugin", "init", "--plugin", "codegraph");
  await runCli(storeRoot, "plugin", "init", "--plugin", "openspec-graph");
  await runCli(storeRoot, "plugin", "connect", "openspec-graph", "--repo", "specs");
  const graphInspection = JSON.parse((await runCli(
    storeRoot,
    "plugin", "exec", "openspec-graph", "inspect", "--json",
  )).stdout);
  const { stdout } = await runCli(storeRoot, "--help");
  const graphInspectHelp = await runCli(
    storeRoot,
    "plugin", "exec", "openspec-graph", "inspect", "--help",
  );
  const graphViewHelp = await runCli(
    storeRoot,
    "plugin", "exec", "openspec-graph", "view", "--help",
  );
  const configured = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );

  assert.deepEqual(configured.plugins, [
    "change-tracking",
    "codegraph",
    "openspec-graph",
  ]);
  assert.deepEqual(graphInspection.summary, {
    nodes: 2,
    edges: 1,
    errors: 0,
    warnings: 0,
  });
  await assert.rejects(fs.access(
    path.join(storeRoot, ".openspec-orch/plugins/openspec-graph/state.json"),
  ), { code: "ENOENT" });
  assert.match(graphInspectHelp.stdout, /plugin-exec inspect/);
  assert.match(graphInspectHelp.stdout, /--json/);
  assert.match(graphViewHelp.stdout, /plugin-exec view/);
  assert.match(graphViewHelp.stdout, /--port/);
  assert.doesNotMatch(`${graphInspectHelp.stdout}\n${graphViewHelp.stdout}`, /\bbuild\b|\bstatus\b|\bimpact\b|check-scope/u);
  const qwenSettings = JSON.parse(
    await fs.readFile(path.join(storeRoot, ".qwen/settings.json"), "utf8"),
  );
  assert.equal(qwenSettings.theme, "dark");
  assert.deepEqual(qwenSettings.mcpServers.existing, { command: "existing-mcp" });
  assert.equal(qwenSettings.mcpServers["openspec-orch-codegraph"], undefined);
  await assert.rejects(fs.access(
    path.join(storeRoot, ".qwen/skills/openspec-graph-maintenance/SKILL.md"),
  ), { code: "ENOENT" });
  await assert.rejects(fs.access(graphSeed), { code: "ENOENT" });
  await runCli(
    storeRoot,
    "plugin", "connect", "change-tracking", "--repo", "specs", "--repo", "frontend",
  );
  const trackingHelp = await runCli(
    storeRoot,
    "plugin", "exec", "--repo", "specs", "change-tracking", "attempt", "--help",
  );
  assert.match(trackingHelp.stdout, /start <change-id> <task-id>/);
  assert.match(trackingHelp.stdout, /complete <change-id> <task-id>/);
  await runCli(
    storeRoot,
    "plugin", "connect", "codegraph", "--repo", "specs", "--repo", "frontend",
  );
  const connectedExtensions = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter(({ args }) => args[1] === "install");
  assert.deepEqual(connectedExtensions.map(({ cwd, args }) => ({
    cwd,
    nativeId: args[2].slice(args[2].lastIndexOf(":") + 1),
    operation: args.slice(0, 2),
    scope: args.slice(-3),
  })), [
    {
      cwd: await fs.realpath(storeRoot),
      nativeId: "openspec-graph-agent",
      operation: ["extensions", "install"],
      scope: ["--scope", "project", "--consent"],
    },
    {
      cwd: await fs.realpath(codeRoot),
      nativeId: "change-tracking-agent",
      operation: ["extensions", "install"],
      scope: ["--scope", "project", "--consent"],
    },
    {
      cwd: await fs.realpath(storeRoot),
      nativeId: "codegraph-agent",
      operation: ["extensions", "install"],
      scope: ["--scope", "project", "--consent"],
    },
  ]);
  const enabledExtensions = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter(({ args }) => args[1] === "enable");
  assert.deepEqual(enabledExtensions.map(({ cwd }) => cwd), [
    await fs.realpath(codeRoot),
  ]);
  assert.equal((await execa(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: codeRoot },
  )).stdout, "");
  await assert.rejects(fs.access(path.join(codeRoot, ".gitignore")));
  const status = await runCli(
    storeRoot,
    "plugin", "status", "--plugin", "codegraph", "--json",
  );
  assert.deepEqual(JSON.parse(status.stdout).plugins.map(({ pluginId, repositoryId, state }) => ({
    pluginId,
    repositoryId,
    state,
  })), [
    { pluginId: "codegraph", repositoryId: "specs", state: "stale" },
    { pluginId: "codegraph", repositoryId: "frontend", state: "ready" },
  ]);
  const humanStatus = await runCli(storeRoot, "plugin", "status", "--plugin", "codegraph");
  assert.match(humanStatus.stdout, /⚠ codegraph → specs — требует обновления/);
  assert.match(humanStatus.stdout, /✓ codegraph → frontend — готов/);
  assert.doesNotMatch(humanStatus.stdout, /^\s*\{/mu);
  const storeStatusBeforeDoctor = (await execa(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: storeRoot },
  )).stdout;
  const doctorCommand = await runCli(storeRoot, "doctor", "--json");
  const doctor = JSON.parse(doctorCommand.stdout);
  assert.equal(doctorCommand.exitCode, 0);
  assert.equal(doctor.version, 1);
  assert.equal(doctor.status, "degraded");
  assert.equal(doctor.summary.error, 0);
  assert.deepEqual(
    doctor.checks.slice(0, 3).map(({ id }) => id),
    ["store", "packages", "openspec"],
  );
  const humanDoctor = await runCli(storeRoot, "doctor");
  assert.match(humanDoctor.stdout, /OpenSpec Orchestrator Doctor/);
  assert.match(humanDoctor.stdout, /⚠ Готово с предупреждениями/);
  assert.match(humanDoctor.stdout, /Результат/);
  assert.match(humanDoctor.stdout, /Проверки/);
  assert.match(humanDoctor.stdout, /Дальше/);
  assert.doesNotMatch(humanDoctor.stdout, /^\s*\{/mu);
  assert.equal((await execa(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: storeRoot },
  )).stdout, storeStatusBeforeDoctor);
  const syncAll = await runCli(storeRoot, "plugin", "sync", "codegraph", "--all");
  assert.match(syncAll.stdout, /✓ codegraph → specs — синхронизирован/);
  assert.match(syncAll.stdout, /✓ codegraph → frontend — синхронизирован/);
  assert.match(syncAll.stdout, /✓ codegraph → specs — готов/);
  assert.match(syncAll.stdout, /✓ codegraph → frontend — готов/);
  const execAll = await runCli(
    storeRoot,
    "plugin", "exec", "--all", "codegraph", "status", "--json",
  );
  assert.match(execAll.stdout, /✓ codegraph → specs — команда выполнена/);
  assert.match(execAll.stdout, /✓ codegraph → frontend — команда выполнена/);
  assert.doesNotMatch(stdout, /\b(?:attempt|graph)\b/u);
  assert.doesNotMatch(stdout, /\b(?:track|done|status|verify)\b/u);
  assert.doesNotMatch(stdout, /\b(?:assign|record)\b/u);
  assert.doesNotMatch(stdout, /\bmcp\b/);
  assert.doesNotMatch(stdout, /change-tracking\s+Команды Plugin/);
  for (const removedCommand of ["assign", "record"]) {
    await assert.rejects(
      runCli(storeRoot, removedCommand),
      (error) => error.exitCode === 2 && /unknown command/u.test(error.stderr),
    );
  }

  const disconnectAll = await runCli(storeRoot, "plugin", "disconnect", "codegraph", "--all");
  assert.match(disconnectAll.stdout, /✓ codegraph → specs — отключён/);
  assert.match(disconnectAll.stdout, /✓ codegraph → frontend — отключён/);
  const disconnectedExtensions = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter(({ args }) => args[1] === "disable");
  assert.deepEqual(disconnectedExtensions, [
    {
      cwd: await fs.realpath(storeRoot),
      args: ["extensions", "disable", "codegraph-agent", "--scope", "workspace"],
    },
    {
      cwd: await fs.realpath(codeRoot),
      args: ["extensions", "disable", "codegraph-agent", "--scope", "workspace"],
    },
  ]);
  await runCli(storeRoot, "plugin", "remove", "codegraph");
  const removed = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(removed.plugins, ["change-tracking", "openspec-graph"]);
  assert.doesNotMatch(
    await fs.readFile(path.join(storeRoot, ".qwen/settings.json"), "utf8"),
    /openspec-orch-codegraph/,
  );
  await runCli(storeRoot, "plugin", "disconnect", "openspec-graph", "--repo", "specs");
  await runCli(storeRoot, "plugin", "remove", "openspec-graph");
  await assert.rejects(fs.access(graphSeed), { code: "ENOENT" });
  const withoutGraph = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(withoutGraph.plugins, ["change-tracking"]);
});

test("candidate distribution serves OpenSpec Graph through public MCP only", async (t) => {
  const { registerCleanup, storeRoot } = await distributionFixture(
    t,
    "openspec-orch-distribution-graph-mcp-",
  );
  await runCli(storeRoot, "plugin", "init", "--plugin", "openspec-graph");
  await runCli(storeRoot, "plugin", "connect", "openspec-graph", "--repo", "specs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_PATH],
    cwd: storeRoot,
    env: { ...process.env },
    stderr: "pipe",
  });
  const client = new Client({ name: "graph-composition-smoke", version: "1.0.0" });
  registerCleanup(() => client.close());
  await client.connect(transport);

  const listed = await client.listTools();
  assert.equal(listed.tools.some(({ name }) => name === "get_spec_graph"), true);
  const report = JSON.parse((await client.callTool({
    name: "get_spec_graph",
    arguments: {},
  })).content[0].text);
  assert.equal(report.summary.nodes, 2);
});

test("candidate distribution installs optional spec-reader with its skill payload", async (t) => {
  const { storeRoot } = await distributionFixture(t, "openspec-orch-spec-reader-");
  const configPath = path.join(storeRoot, "openspec-orch.yaml");
  const before = configuration.parseProject(await fs.readFile(configPath, "utf8"));
  assert.equal(before.extensions.includes("spec-reader"), false);

  await runCli(storeRoot, "extension", "init", "spec-reader");
  const initialized = await fs.readFile(configPath, "utf8");
  assert.deepEqual(configuration.parseProject(initialized).extensions,
    [...before.extensions, "spec-reader"]);
  await runCli(storeRoot, "extension", "init", "spec-reader");
  assert.equal(await fs.readFile(configPath, "utf8"), initialized);
  await runCli(storeRoot, "extension", "connect", "spec-reader");

  const extensionRoot = path.resolve(path.dirname(CLI_PATH), "../extensions/spec-reader");
  const skillPath = path.join(extensionRoot, "skills/specs-to-business/SKILL.md");
  const skill = await fs.readFile(skillPath, "utf8");
  const metadata = parse(skill.split("---\n")[1]);
  assert.equal(metadata.name, "specs-to-business");
  for (const manifest of ["qwen-extension.json", "gigacode-extension.json", ".claude-plugin/plugin.json"]) {
    const value = JSON.parse(await fs.readFile(path.join(extensionRoot, manifest), "utf8"));
    assert.equal(value.name, "spec-reader");
    if (value.contextFileName) {
      await fs.access(path.join(extensionRoot, value.contextFileName));
    }
  }
  await assert.rejects(fs.access(path.join(storeRoot, "docs/business")), { code: "ENOENT" });
});

test("public CLI initializes and connects non-Git directories without losing user files", async (t) => {
  const { storeRoot, codeRoot } = await distributionFixture(t, "openspec-orch-first-run-");
  for (const entry of await fs.readdir(storeRoot)) {
    if (entry !== ".git") await fs.rm(path.join(storeRoot, entry), { recursive: true, force: true });
  }
  await fs.rm(path.join(storeRoot, ".git"), { recursive: true });
  await fs.rm(path.join(codeRoot, ".git"), { recursive: true });
  await fs.writeFile(path.join(storeRoot, "user-notes.md"), "Keep my notes");
  for (const name of ["xdg-config", "xdg-data"]) {
    await fs.rm(path.join(path.dirname(storeRoot), name), { recursive: true, force: true });
  }
  const args = ["init", ".", "--store", "specs", "--agent", "qwen",
    "--repo", "frontend=https://example.test/frontend.git#main"];
  await runCli(storeRoot, ...args);
  const config = await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8");
  assert.deepEqual(configuration.parseProject(config).extensions, ["spec-driven-extended", "superpowers"]);
  await runCli(storeRoot, ...args);
  assert.equal(await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"), config);
  assert.equal(configuration.parseProject(config).storeRepository.remote, undefined);
  assert.doesNotMatch(config, /^strict:/mu);
  await runCli(storeRoot, "connect");
  const pointer = await fs.readFile(path.join(codeRoot, "openspec/config.yaml"), "utf8");
  await runCli(codeRoot, "connect");
  assert.equal(await fs.readFile(path.join(codeRoot, "openspec/config.yaml"), "utf8"), pointer);
  assert.equal(await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"), config);
  assert.equal(await fs.readFile(path.join(storeRoot, "user-notes.md"), "utf8"), "Keep my notes");
  const report = JSON.parse((await runCli(codeRoot, "doctor", "--json")).stdout);
  assert.equal(report.summary.error, 0);
  await assert.rejects(fs.access(path.join(codeRoot, "openspec/specs")), /ENOENT/);
  await assert.rejects(fs.access(path.join(codeRoot, "openspec/changes")), /ENOENT/);
});

test("public CLI initializes the initiative Template without code workflows", async (t) => {
  const { storeRoot } = await distributionFixture(t, "openspec-orch-initiative-");
  for (const entry of await fs.readdir(storeRoot)) {
    if (entry !== ".git") await fs.rm(path.join(storeRoot, entry), { recursive: true, force: true });
  }
  await commitAll(storeRoot, "Prepare initiative Store");
  for (const name of ["xdg-config", "xdg-data"]) {
    await fs.rm(path.join(path.dirname(storeRoot), name), { recursive: true, force: true });
  }
  await runCli(storeRoot, "init", ".", "--store", "specs", "--agent", "qwen", "--template", "initiative");
  const config = configuration.parseProject(await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"));
  assert.deepEqual(config.extensions, ["initiative"]);
  assert.equal(config.template.id, "initiative");
  assert.equal(parse(await fs.readFile(path.join(storeRoot, "openspec/config.yaml"), "utf8")).schema, "initiative");
  await runCli(storeRoot, "extension", "connect", "initiative");
  await fs.access(path.join(storeRoot, "openspec/schemas/initiative/templates/verify.md"));
  await execa("openspec", ["new", "change", "shared-outcome", "--schema", "initiative"], { cwd: storeRoot });
  const client = new Client({ name: "initiative-smoke", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [MCP_PATH],
      cwd: storeRoot, env: { ...process.env }, stderr: "pipe" }));
    const response = await client.callTool({ name: "get_next_action", arguments: { change_id: "shared-outcome" } });
    assert.notEqual(response.isError, true, JSON.stringify(response.content));
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.action, "prepare_artifact");
    assert.equal(result.artifact, "proposal");
    const context = await client.callTool({ name: "get_change_context", arguments: {
      change_id: "shared-outcome", artifact: "proposal",
    } });
    assert.notEqual(context.isError, true, JSON.stringify(context.content));
    assert.match(JSON.stringify(context.content), /initiative/);
  } finally {
    await client.close();
  }

});
