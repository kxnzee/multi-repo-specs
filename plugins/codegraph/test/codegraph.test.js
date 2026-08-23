/** @fileoverview Самостоятельный контракт поставки CodeGraph Plugin Package. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin from "../index.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const launcher = path.join(packageRoot, "bin", "codegraph.js");

/** Создаёт изолированный project root для Agent integration tests. */
async function temporaryProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-codegraph-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

/** Запускает Plugin-owned Agent lifecycle без глобального CodeGraph executable. */
function runAgentLifecycle(root, operation, agentId) {
  return spawnSync(
    process.execPath,
    [launcher, "agent", operation, "--agent", agentId],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    },
  );
}

test("Package owns its CodeGraph dependency and descriptor", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  const descriptor = parse(await fs.readFile(path.join(packageRoot, "plugin.yaml"), "utf8"));

  assert.equal(packageManifest.name, "@openspec-orch/plugin-codegraph");
  assert.equal(packageManifest.dependencies["@colbymchenry/codegraph"], "1.5.0");
  assert.equal(packageManifest.openspecOrchestrator.entrypoint, "bin/codegraph.js");
  assert.equal(descriptor.id, "codegraph");
  assert.equal(descriptor.version, packageManifest.version);
  assert.deepEqual(assertPluginContract({ plugin, packageManifest }), {
    id: "codegraph",
    commands: [],
  });
});

test("Native repository lifecycle delegates to the package launcher", async () => {
  const calls = [];
  const context = Object.freeze({
    process: Object.freeze({
      run(executable, args) {
        calls.push([executable, args]);
        return Promise.resolve(args[1] === "status" ? "indexed" : "");
      },
    }),
  });

  await plugin.connect(context);
  assert.deepEqual(await plugin.status(context), { state: "ready", details: "indexed" });
  await plugin.sync(context);
  assert.deepEqual(calls, [
    [process.execPath, [launcher, "init", "."]],
    [process.execPath, [launcher, "status", "."]],
    [process.execPath, [launcher, "sync", "."]],
  ]);
});

test("Package launcher runs without a global CodeGraph executable", () => {
  const result = spawnSync(
    process.execPath,
    [launcher, "--version"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "1.5.0");
});

test("Package installs and removes MCP for registered Qwen and Codex Agents", async (t) => {
  const root = await temporaryProject(t);
  await fs.mkdir(path.join(root, ".qwen"), { recursive: true });
  await fs.mkdir(path.join(root, ".codex"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".qwen", "settings.json"),
    `${JSON.stringify({
      theme: "dark",
      mcpServers: { existing: { command: "existing-server" } },
    }, null, 2)}\n`,
  );
  await fs.writeFile(path.join(root, "QWEN.md"), "# Team instructions\n");
  await fs.writeFile(path.join(root, ".codex", "config.toml"), "model = \"gpt-test\"\n");
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Project instructions\n");

  for (const agentId of ["qwen", "codex"]) {
    const result = runAgentLifecycle(root, "install", agentId);
    assert.equal(result.status, 0, result.stderr);
  }
  const qwenPath = path.join(root, ".qwen", "settings.json");
  const codexPath = path.join(root, ".codex", "config.toml");
  const canonicalRoot = await fs.realpath(root);
  const qwen = JSON.parse(await fs.readFile(qwenPath, "utf8"));
  assert.deepEqual(qwen.mcpServers.existing, { command: "existing-server" });
  assert.deepEqual(qwen.mcpServers["openspec-orch-codegraph"], {
    command: process.execPath,
    args: [launcher, "serve", "--mcp"],
    cwd: canonicalRoot,
  });
  assert.match(await fs.readFile(path.join(root, "QWEN.md"), "utf8"), /codegraph_explore/);
  const codex = await fs.readFile(codexPath, "utf8");
  assert.match(codex, /model = "gpt-test"/);
  assert.match(codex, /\[mcp_servers\."openspec-orch-codegraph"\]/);
  assert.match(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), /codegraph_explore/);

  const stableQwen = await fs.readFile(qwenPath, "utf8");
  const stableCodex = await fs.readFile(codexPath, "utf8");
  assert.equal(runAgentLifecycle(root, "install", "qwen").status, 0);
  assert.equal(runAgentLifecycle(root, "install", "codex").status, 0);
  assert.equal(await fs.readFile(qwenPath, "utf8"), stableQwen);
  assert.equal(await fs.readFile(codexPath, "utf8"), stableCodex);

  for (const agentId of ["qwen", "codex"]) {
    const result = runAgentLifecycle(root, "remove", agentId);
    assert.equal(result.status, 0, result.stderr);
  }
  const removedQwen = JSON.parse(await fs.readFile(qwenPath, "utf8"));
  assert.deepEqual(removedQwen.mcpServers, { existing: { command: "existing-server" } });
  assert.doesNotMatch(await fs.readFile(path.join(root, "QWEN.md"), "utf8"), /codegraph_explore/);
  assert.doesNotMatch(await fs.readFile(codexPath, "utf8"), /openspec-orch-codegraph/);
  assert.doesNotMatch(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), /codegraph_explore/);
});

test("Package installs and removes MCP for Claude and GigaCode Agents", async (t) => {
  const root = await temporaryProject(t);
  await fs.mkdir(path.join(root, ".gigacode"), { recursive: true });

  for (const agentId of ["claude", "gigacode"]) {
    const result = runAgentLifecycle(root, "install", agentId);
    assert.equal(result.status, 0, result.stderr);
  }
  const canonicalRoot = await fs.realpath(root);
  for (const relativePath of [".mcp.json", ".gigacode/settings.json"]) {
    const config = JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
    assert.deepEqual(config.mcpServers["openspec-orch-codegraph"], {
      command: process.execPath,
      args: [launcher, "serve", "--mcp"],
      cwd: canonicalRoot,
    });
  }
  assert.match(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8"), /codegraph_explore/);
  assert.match(await fs.readFile(path.join(root, "GIGACODE.md"), "utf8"), /codegraph_explore/);

  for (const agentId of ["claude", "gigacode"]) {
    const result = runAgentLifecycle(root, "remove", agentId);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.doesNotMatch(await fs.readFile(path.join(root, ".mcp.json"), "utf8"), /codegraph/);
  assert.doesNotMatch(
    await fs.readFile(path.join(root, ".gigacode", "settings.json"), "utf8"),
    /codegraph/,
  );
  assert.equal(await fs.readFile(path.join(root, "CLAUDE.md"), "utf8"), "");
  assert.equal(await fs.readFile(path.join(root, "GIGACODE.md"), "utf8"), "");
});

test("Package rejects an Agent without a CodeGraph adapter", async (t) => {
  const root = await temporaryProject(t);
  const result = runAgentLifecycle(root, "install", "unknown-agent");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CODEGRAPH_AGENT_UNSUPPORTED/);
});
