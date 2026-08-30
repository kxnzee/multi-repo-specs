/** @fileoverview Самостоятельный контракт поставки CodeGraph Plugin Package. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin from "../index.js";

const packageRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const launcher = path.join(packageRoot, "bin", "codegraph.js");

test("Package owns its CodeGraph dependency and native Plugin entrypoint", async () => {
  const packageManifest = JSON.parse(await fs.readFile(
    path.join(packageRoot, "package.json"),
    "utf8",
  ));
  assert.equal(packageManifest.name, "@openspec-orch/plugin-codegraph");
  assert.equal(packageManifest.dependencies["@colbymchenry/codegraph"], "1.5.0");
  assert.deepEqual(packageManifest.openspecOrchestrator, {
    apiVersion: 1,
    plugin: "./index.js",
  });
  assert.deepEqual(assertPluginContract({ plugin, packageManifest }), {
    id: "codegraph",
    commands: [],
  });
  assert.equal(plugin.canExec(), true);
  assert.equal(plugin.hasExtensionContribution(), true);
  const repository = Object.freeze({ id: "frontend", role: "code" });
  assert.deepEqual(plugin.extensions(Object.freeze({ repository })).map((extension) => ({
    id: extension.id,
    root: extension.root,
    target: extension.target,
  })), [{
    id: "agent",
    root: "./extension",
    target: repository,
  }]);
});

test("Package ships one native Agent Extension for Claude, Qwen and GigaCode", async () => {
  const extensionRoot = path.join(packageRoot, "extension");
  const qwen = JSON.parse(await fs.readFile(
    path.join(extensionRoot, "qwen-extension.json"),
    "utf8",
  ));
  const gigacode = JSON.parse(await fs.readFile(
    path.join(extensionRoot, "gigacode-extension.json"),
    "utf8",
  ));
  const claude = JSON.parse(await fs.readFile(
    path.join(extensionRoot, ".claude-plugin", "plugin.json"),
    "utf8",
  ));
  const marketplace = JSON.parse(await fs.readFile(
    path.join(extensionRoot, ".claude-plugin", "marketplace.json"),
    "utf8",
  ));
  const claudeMcp = JSON.parse(await fs.readFile(
    path.join(extensionRoot, ".mcp.json"),
    "utf8",
  ));

  assert.equal(qwen.name, "codegraph-agent");
  assert.equal(qwen.contextFileName, "agent-instructions.md");
  assert.equal(gigacode.name, "codegraph-agent");
  assert.equal(gigacode.contextFileName, "agent-instructions.md");
  assert.equal(claude.name, "codegraph-agent");
  assert.deepEqual(marketplace, {
    name: "openspec-orch-codegraph-agent",
    description: "Bundled CodeGraph Agent Extension",
    owner: { name: "OpenSpec Orchestrator" },
    plugins: [{ name: "codegraph-agent", source: "./" }],
  });
  assert.deepEqual(qwen.mcpServers["openspec-orch-codegraph"], {
    command: "openspec-orch-codegraph",
    args: ["serve", "--mcp"],
    cwd: "${workspacePath}",
  });
  assert.deepEqual(gigacode.mcpServers, qwen.mcpServers);
  assert.deepEqual(claudeMcp.mcpServers["openspec-orch-codegraph"], {
    command: "openspec-orch-codegraph",
    args: ["serve", "--mcp"],
    cwd: "${CLAUDE_PROJECT_DIR}",
  });
});

test("Native repository lifecycle delegates to the package launcher", async () => {
  const calls = [];
  const readyDetails = JSON.stringify({
    initialized: true,
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    index: { state: "complete", reindexRecommended: false },
  });
  const context = Object.freeze({
    process: Object.freeze({
      run(executable, args) {
        calls.push([executable, args]);
        return Promise.resolve(args[1] === "status" ? readyDetails : "");
      },
    }),
  });

  await plugin.connect(context);
  assert.deepEqual(await plugin.status(context), { state: "ready", details: readyDetails });
  await plugin.sync(context);
  await plugin.exec(context, ["explore", "authentication flow", "--json"]);
  assert.deepEqual(calls, [
    [process.execPath, [launcher, "init", "."]],
    [process.execPath, [launcher, "status", ".", "--json"]],
    [process.execPath, [launcher, "sync", "."]],
    [process.execPath, [launcher, "explore", "authentication flow", "--json"]],
  ]);
});

test("Repository status maps native CodeGraph freshness without false ready", async () => {
  const ready = {
    initialized: true,
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    worktreeMismatch: null,
    index: { state: "complete", reindexRecommended: false },
  };
  const cases = [
    [{ ...ready, pendingChanges: { ...ready.pendingChanges, modified: 1 } }, "stale"],
    [{ initialized: false, lastIndexed: null }, "unavailable"],
    [{ ...ready, worktreeMismatch: { head: "new-revision" } }, "stale"],
    [{ ...ready, index: { ...ready.index, reindexRecommended: true } }, "stale"],
    [{ ...ready, index: { ...ready.index, state: "partial" } }, "unavailable"],
  ];

  for (const [value, state] of cases) {
    const details = JSON.stringify(value);
    const context = Object.freeze({
      process: Object.freeze({
        run() { return Promise.resolve(details); },
      }),
    });
    assert.deepEqual(await plugin.status(context), { state, details });
  }
});
