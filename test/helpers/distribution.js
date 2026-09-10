/** @fileoverview Isolated fixtures and candidate entrypoints for distribution smoke. */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { configuration, createProject } from "@openspec-orch/core";

export const CLI_PATH = process.env.OPENSPEC_ORCH_TEST_CLI_PATH ??
  fileURLToPath(new URL("../../bin/openspec-orch.js", import.meta.url));
export const MCP_PATH = process.env.OPENSPEC_ORCH_TEST_MCP_PATH ?? fileURLToPath(new URL("../../bin/openspec-orch-mcp.js", import.meta.url));

/** Запускает candidate CLI в изолированном Store. */
export function runCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd });
}

/** Создаёт fake Qwen с общей установкой packages и workspace-scoped activation. */
export async function writeFakeQwen(fakeBin) {
  await fs.writeFile(path.join(fakeBin, "qwen.js"), [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    "const log = process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;",
    "const installedPath = `${log}.installed.json`;",
    "const sourcesPath = `${log}.sources.json`;",
    'const sources = fs.existsSync(sourcesPath) ? JSON.parse(fs.readFileSync(sourcesPath, "utf8")) : {};',
    "const installed = fs.existsSync(installedPath)",
    '  ? JSON.parse(fs.readFileSync(installedPath, "utf8")) : [];',
    "fs.appendFileSync(log, `${JSON.stringify({ cwd: process.cwd(), args })}\\n`);",
    'if (args[0] === "extensions" && args[1] === "enable" && !installed.includes(args[2])) {',
    "  process.stderr.write(`Расширение ${args[2]} не существует.\\n`);",
    "  process.exit(1);",
    "}",
    'if (args[0] === "extensions" && args[1] === "install") {',
    '  const suffix = args[2].slice(args[2].lastIndexOf(":") + 1);',
    '  const nativeId = suffix.includes(path.sep) ? path.basename(args[2]) : suffix;',
    "  if (!installed.includes(nativeId)) installed.push(nativeId);",
    '  sources[nativeId] = args[2].slice(0, args[2].lastIndexOf(":"));',
    '  fs.writeFileSync(sourcesPath, JSON.stringify(sources));',
    '  fs.writeFileSync(installedPath, JSON.stringify(installed));',
    "}",
    'if (args[0] === "extensions" && args[1] === "uninstall") {',
    "  const index = installed.indexOf(args[2]);",
    "  if (index !== -1) installed.splice(index, 1);",
    '  fs.writeFileSync(installedPath, JSON.stringify(installed));',
    "}",
    'if (args[0] === "extensions" && args[1] === "list") {',
    '  process.stdout.write(installed.map((id) => `✓ ${id} (1.0.0)\\n Path: ${sources[id]}\\n Enabled (Workspace): true\\n Enabled (User): true`).join("\\n\\n"));',
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

/** Фиксирует текущее состояние изолированного fixture без зависимости от user config. */
export async function commitAll(root, message) {
  await execa("git", ["add", "."], { cwd: root });
  await execa(
    "git",
    [
      "-c", "user.name=OpenSpec Orchestrator Test",
      "-c", "user.email=orchestrator@example.test",
      "commit", "-m", message,
    ],
    { cwd: root },
  );
}

/** Создаёт общий public-distribution fixture с упорядоченным освобождением ресурсов. */
export async function distributionFixture(t, prefix) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const storeRoot = path.join(workspaceRoot, "specs");
  const codeRoot = path.join(workspaceRoot, "src", "frontend");
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;
  const originalPath = process.env.PATH;
  const originalNativeLog = process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;
  const resourceCleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of resourceCleanups.reverse()) await cleanup();
    } finally {
      if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
      if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = originalXdgDataHome;
      process.env.PATH = originalPath;
      if (originalNativeLog === undefined) delete process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG;
      else process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG = originalNativeLog;
      await fs.rm(workspaceRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });
  process.env.XDG_CONFIG_HOME = path.join(workspaceRoot, "xdg-config");
  process.env.XDG_DATA_HOME = path.join(workspaceRoot, "xdg-data");
  const fakeBin = path.join(workspaceRoot, "bin");
  const nativeLog = path.join(workspaceRoot, "qwen-native.jsonl");
  await fs.mkdir(fakeBin);
  await writeFakeQwen(fakeBin);
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath}`;
  process.env.OPENSPEC_ORCH_FAKE_QWEN_LOG = nativeLog;
  await fs.mkdir(storeRoot);
  await fs.mkdir(codeRoot, { recursive: true });
  await fs.writeFile(path.join(codeRoot, "index.js"), "export const ready = true;\n");
  await fs.mkdir(path.join(storeRoot, ".openspec-store"));
  await fs.mkdir(path.join(storeRoot, "openspec"));
  const project = createProject({
    version: 1,
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

  return Object.freeze({
    codeRoot,
    nativeLog,
    registerCleanup(cleanup) {
      resourceCleanups.push(cleanup);
    },
    storeRoot,
  });
}
