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

import {
  commitFiles,
  createCheckoutWithRemote,
  runCommand,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const CLI_PATH = process.env.OPENSPEC_ORCH_TEST_CLI_PATH ??
  fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));

/** Запускает candidate CLI в изолированном Store. */
function runCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd });
}

/** Запускает подтверждаемую command через реальный stdin публичного CLI. */
function confirmCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd, input: "y\n" });
}

/** Создаёт fake Qwen с общей установкой packages и workspace-scoped activation. */
async function writeFakeQwen(fakeBin) {
  await fs.writeFile(path.join(fakeBin, "qwen.js"), [
    'const fs = require("node:fs");',
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
    '  const nativeId = args[2].slice(args[2].lastIndexOf(":") + 1);',
    "  if (!installed.includes(nativeId)) installed.push(nativeId);",
    '  fs.writeFileSync(installedPath, JSON.stringify(installed));',
    "}",
    'if (args[0] === "extensions" && args[1] === "list") {',
    '  process.stdout.write(installed.map((id) => `✓ ${id} (1.0.0)\\n Enabled (Workspace): true`).join("\\n\\n"));',
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
    template: { id: "base" },
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
  for (const command of ["assign", "status", "record", "verify"]) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`));
  }
  assert.doesNotMatch(stdout, /\bmcp\b/);
  assert.doesNotMatch(stdout, /change-tracking\s+Команды Plugin/);

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

test("candidate distribution completes Change Tracking through the public CLI", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orch-distribution-cycle-");
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
  const store = await createCheckoutWithRemote(
    root,
    "workspace/specs",
    "specs",
    { "openspec/config.yaml": "schema: spec-driven\n" },
  );
  const frontend = await createCheckoutWithRemote(
    root,
    "workspace/src/frontend",
    "frontend",
    { "README.md": "frontend\n" },
  );
  const backend = await createCheckoutWithRemote(
    root,
    "workspace/src/backend",
    "backend",
    { "README.md": "backend\n" },
  );
  const repository = ({ id, role, remote }) => ({
    id,
    role,
    remote,
    defaultBranch: "main",
    plugins: [],
  });
  const project = createProject({
    version: 2,
    strict: true,
    template: { id: "base" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [],
    repositories: [
      repository({ id: "specs", role: "store", remote: store.remote }),
      repository({ id: "frontend", role: "code", remote: frontend.remote }),
      repository({ id: "backend", role: "code", remote: backend.remote }),
    ],
  });
  await writeFiles(store.checkout, {
    ".gitignore": [
      ".openspec-orch/cache/",
      ".openspec-orch/plugins/",
      ".openspec-orch/state.json",
      "",
    ].join("\n"),
    ".openspec-store/store.yaml": [
      "version: 1",
      "id: specs",
      `remote: ${JSON.stringify(store.remote)}`,
      "",
    ].join("\n"),
    "openspec-orch.yaml": configuration.serializeProject(project),
  });
  await commitFiles(store.checkout, {}, { message: "configure distribution Store" });

  await runCli(store.checkout, "plugin", "init", "--plugin", "change-tracking");
  const applySkill = ".qwen/skills/change-tracking-apply-context/SKILL.md";
  await assert.rejects(fs.access(path.join(store.checkout, applySkill)), { code: "ENOENT" });
  await runCli(
    store.checkout,
    "plugin", "connect", "change-tracking",
    "--repo", "specs", "--repo", "frontend", "--repo", "backend",
  );
  const extensionCalls = (await fs.readFile(nativeLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter(({ args }) => args[1] === "install");
  assert.equal(extensionCalls.length, 1);
  assert.equal(extensionCalls[0].cwd, await fs.realpath(store.checkout));
  assert.deepEqual(extensionCalls[0].args.slice(0, 2), ["extensions", "install"]);
  assert.match(
    extensionCalls[0].args[2],
    /plugins\/change-tracking\/extension:change-tracking-agent$/u,
  );
  await runCommand("git", ["-C", store.checkout, "add", "openspec-orch.yaml"]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "enable change tracking"]);

  await confirmCli(
    store.checkout,
    "assign", "checkout-flow", "--repo", "frontend", "--repo", "backend",
  );
  const cyclePath = ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json";
  await runCommand("git", ["-C", store.checkout, "add", cyclePath]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "assign checkout flow"]);

  await assert.rejects(
    runCli(store.checkout, "verify", "checkout-flow"),
    (error) => error.exitCode === 1 && /CYCLE_MISMATCH/.test(error.stderr),
  );
  await assert.rejects(
    runCli(
      store.checkout,
      "record", "assignment", "checkout-flow",
      "--repo", "frontend", "--commit", "0000000000000000000000000000000000000000",
      "--status", "completed", "--source", "agent",
    ),
    (error) => error.exitCode === 1 && /COMMIT_NOT_FOUND/.test(error.stderr),
  );

  for (const [repositoryId, checkout] of [
    ["frontend", frontend.checkout],
    ["backend", backend.checkout],
  ]) {
    const revision = await runCommand("git", ["-C", checkout, "rev-parse", "HEAD"]);
    await confirmCli(
      store.checkout,
      "record", "assignment", "checkout-flow",
      "--repo", repositoryId, "--commit", revision,
      "--status", "completed", "--source", "agent",
    );
  }
  const verified = await runCli(store.checkout, "verify", "checkout-flow");
  assert.match(verified.stdout, /snapshot_id: snap-v1-/);
  await confirmCli(
    store.checkout,
    "record", "verification", "checkout-flow", "--result", "pass", "--source", "human",
  );
  const status = JSON.parse((await runCli(
    store.checkout,
    "status", "checkout-flow", "--json",
  )).stdout);
  const execStatus = JSON.parse((await runCli(
    store.checkout,
    "plugin", "exec", "change-tracking", "--repo", "specs", "--",
    "status", "checkout-flow", "--json",
  )).stdout);

  assert.equal(status.next_action, "готово");
  assert.equal(execStatus.current_repository, null);
  assert.equal(execStatus.change_id, status.change_id);
  assert.equal(execStatus.cycle_id, status.cycle_id);
  assert.deepEqual(execStatus.results, status.results);
  assert.deepEqual(execStatus.snapshot, status.snapshot);
  assert.deepEqual(execStatus.verification, status.verification);
  assert.equal(status.verification.result, "pass");
  assert.deepEqual(status.results.map(({ repository_id: id, status: state }) => ({ id, state })), [
    { id: "frontend", state: "completed" },
    { id: "backend", state: "completed" },
  ]);
});
