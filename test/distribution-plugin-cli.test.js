/** @fileoverview Distribution composition smoke for bundled Plugin packages. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { configuration, createProject } from "@openspec-orch/core";

const CLI_PATH = process.env.OPENSPEC_ORCH_TEST_CLI_PATH ??
  fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));

/** Запускает candidate CLI в изолированном Store. */
function runCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd });
}

/** Создаёт fake Qwen с общей установкой packages и workspace-scoped activation. */
async function writeFakeQwen(fakeBin) {
  await fs.writeFile(path.join(fakeBin, "qwen.js"), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    "const log = process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;",
    "const installedPath = `${log}.installed.json`;",
    "const installed = fs.existsSync(installedPath)",
    '  ? JSON.parse(fs.readFileSync(installedPath, "utf8")) : [];',
    "fs.appendFileSync(log, `${JSON.stringify({ cwd: process.cwd(), args })}\\n`);",
    'if (args[0] === "extensions" && args[1] === "enable" && !installed.includes(args[2])) {',
    "  process.stderr.write(`Extension with name ${args[2]} does not exist.\\n`);",
    "  process.exit(1);",
    "}",
    'if (args[0] === "extensions" && args[1] === "install") {',
    '  const suffix = args[2].slice(args[2].lastIndexOf(":") + 1);',
    '  const nativeId = suffix.includes(path.sep) ? path.basename(args[2]) : suffix;',
    "  if (!installed.includes(nativeId)) installed.push(nativeId);",
    '  fs.writeFileSync(installedPath, JSON.stringify(installed));',
    "}",
    'if (args[0] === "extensions" && args[1] === "uninstall") {',
    "  const index = installed.indexOf(args[2]);",
    "  if (index !== -1) installed.splice(index, 1);",
    '  fs.writeFileSync(installedPath, JSON.stringify(installed));',
    "}",
    'if (args[0] === "extensions" && args[1] === "list") {',
    '  process.stdout.write(installed.map((id) => `✓ ${id} (1.0.0)\\n Enabled (Workspace): true\\n Enabled (User): true`).join("\\n\\n"));',
    "}",
    "",
  ].join("\n"));
  await fs.writeFile(
    path.join(fakeBin, "qwen"),
    '#!/usr/bin/env node\nrequire("./qwen.js");\n',
    { mode: 0o755 },
  );
  // Windows не исполняет shebang-скрипты: cross-spawn резолвит `qwen` в qwen.cmd через PATHEXT.
  await fs.writeFile(
    path.join(fakeBin, "qwen.cmd"),
    '@echo off\r\nnode "%~dp0qwen.js" %*\r\n',
  );
}

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
    ["extensions", "enable", "orchestrator-agent", "--scope", "user"],
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
    ["--version"],
    ["extensions", "list"],
    ["extensions", "uninstall", "orchestrator-agent"],
  ]);
});

/** Инициализирует реальный Git Repository для distribution smoke. */
async function initializeGitRepository(root) {
  await execa("git", ["init", "--initial-branch=main"], { cwd: root });
  await execa("git", ["add", "."], { cwd: root });
  await execa(
    "git",
    [
      "-c", "user.name=OpenSpec Orchestrator Test",
      "-c", "user.email=orchestrator@example.test",
      "commit", "-m", "Initial fixture",
    ],
    { cwd: root },
  );
}

test("candidate distribution initializes bundled Plugins and mounts trusted root commands", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-distribution-"));
  const storeRoot = path.join(workspaceRoot, "specs");
  const codeRoot = path.join(workspaceRoot, "src", "frontend");
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_CONFIG_HOME = path.join(workspaceRoot, "xdg-config");
  process.env.XDG_DATA_HOME = path.join(workspaceRoot, "xdg-data");
  t.after(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
  });
  const fakeBin = path.join(workspaceRoot, "bin");
  const nativeLog = path.join(workspaceRoot, "qwen-native.jsonl");
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
  await fs.mkdir(storeRoot);
  await fs.mkdir(codeRoot, { recursive: true });
  await fs.writeFile(path.join(codeRoot, "index.js"), "export const ready = true;\n");
  await fs.mkdir(path.join(storeRoot, ".openspec-store"));
  await fs.mkdir(path.join(storeRoot, "openspec"));
  const project = createProject({
    version: 2,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [],
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
    path.join(storeRoot, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(
    path.join(storeRoot, "openspec-orch.yaml"),
    configuration.serializeProject(project),
  );
  await fs.writeFile(path.join(storeRoot, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.mkdir(path.join(storeRoot, ".qwen"));
  await fs.writeFile(path.join(storeRoot, ".qwen/settings.json"), `${JSON.stringify({
    theme: "dark",
    mcpServers: { existing: { command: "existing-mcp" } },
  }, null, 2)}\n`);
  await initializeGitRepository(storeRoot);
  await initializeGitRepository(codeRoot);
  await execa("git", ["remote", "add", "origin", "https://example.test/specs.git"], {
    cwd: storeRoot,
  });
  await execa("git", ["remote", "add", "origin", "https://example.test/frontend.git"], {
    cwd: codeRoot,
  });
  await execa(
    "openspec",
    ["store", "register", storeRoot, "--id", "specs", "--yes", "--json"],
    { cwd: storeRoot },
  );

  const graphSeed = path.join(storeRoot, "openspec/graph.yaml");
  await assert.rejects(fs.access(graphSeed), { code: "ENOENT" });
  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(storeRoot, "plugin", "init", "--plugin", "codegraph");
  await runCli(storeRoot, "plugin", "init", "--plugin", "openspec-graph");
  await runCli(storeRoot, "plugin", "connect", "openspec-graph", "--repo", "specs");
  const graphInspection = JSON.parse((await runCli(
    storeRoot,
    "graph", "inspect", "--json",
  )).stdout);
  const { stdout } = await runCli(storeRoot, "--help");
  const graphHelp = await runCli(storeRoot, "graph", "--help");
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
  assert.match(graphHelp.stdout, /inspect/);
  assert.match(graphHelp.stdout, /view/);
  assert.doesNotMatch(graphHelp.stdout, /\bbuild\b/);
  assert.doesNotMatch(graphHelp.stdout, /\bstatus\b/);
  assert.doesNotMatch(graphHelp.stdout, /\bimpact\b/);
  assert.doesNotMatch(graphHelp.stdout, /check-scope/);
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
    "plugin", "connect", "codegraph", "--repo", "specs", "--repo", "frontend",
  );
  const connectedExtensions = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter(({ args }) => args[1] === "install");
  assert.deepEqual(connectedExtensions.map(({ cwd, args }) => ({
    cwd,
    operation: args.slice(0, 2),
    scope: args.slice(-3),
  })), [
    {
      cwd: await fs.realpath(storeRoot),
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
    await fs.realpath(storeRoot),
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
    doctor.checks.slice(0, 2).map(({ id }) => id),
    ["store", "openspec"],
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
    "plugin", "exec", "codegraph", "--all", "--", "status", "--json",
  );
  assert.match(execAll.stdout, /✓ codegraph → specs — команда выполнена/);
  assert.match(execAll.stdout, /✓ codegraph → frontend — команда выполнена/);
  assert.match(stdout, /\battempt\b/u);
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
