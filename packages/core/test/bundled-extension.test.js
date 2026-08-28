/** @fileoverview Контракт встроенного каталога standalone Agent Extensions. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundledExtensionPackage,
  BundledExtensionProvider,
} from "@openspec-orch/core";

const OPENSPEC_BASE_ROOT = fileURLToPath(
  new URL("../../../extensions/openspec-base/", import.meta.url),
);
const SUPERPOWERS_ROOT = fileURLToPath(
  new URL("../../../extensions/superpowers/", import.meta.url),
);
const AGENT_IDS = Object.freeze(["claude", "gigacode", "qwen"]);

/** Загружает Extension против фактического Agent catalog тестового distribution. */
function loadExtension(root) {
  return BundledExtensionPackage.load(root, { agentIds: AGENT_IDS });
}

/** Создаёт минимальный Extension payload со всеми обязательными manifests. */
async function createExtension(t, id = "workflow") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-bundled-extension-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".claude-plugin"));
  await fs.writeFile(path.join(root, "extension.yaml"), [
    `id: ${id}`,
    "name: Workflow Extension",
    "manifests:",
    "  claude: .claude-plugin/plugin.json",
    "  qwen: qwen-extension.json",
    "  gigacode: gigacode-extension.json",
    "",
  ].join("\n"));
  await Promise.all([
    fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), "{}\n"),
    fs.writeFile(path.join(root, "qwen-extension.json"), "{}\n"),
    fs.writeFile(path.join(root, "gigacode-extension.json"), "{}\n"),
  ]);
  return root;
}

test("BundledExtensionProvider resolves a portable bundled source to its local payload", async (t) => {
  const root = await createExtension(t);
  const extensionPackage = await loadExtension(root);
  const provider = new BundledExtensionProvider([extensionPackage]);

  assert.deepEqual(provider.catalog.entries.map(({ id, name, source }) => ({
    id,
    name,
    source,
  })), [{
    id: "workflow",
    name: "Workflow Extension",
    source: "bundled:workflow",
  }]);
  const resolved = provider.resolve({ id: "workflow", source: "bundled:workflow" });
  assert.deepEqual({
    id: resolved.id,
    name: resolved.name,
    root: resolved.root,
    source: resolved.source,
    manifests: resolved.manifests,
  }, {
    id: "workflow",
    name: "Workflow Extension",
    root: await fs.realpath(root),
    source: "bundled:workflow",
    manifests: {
      claude: ".claude-plugin/plugin.json",
      qwen: "qwen-extension.json",
      gigacode: "gigacode-extension.json",
    },
  });
  assert.equal(Object.isFrozen(resolved), true);
  assert.throws(
    () => provider.resolve({ id: "workflow", source: "bundled:other" }),
    /BUNDLED_EXTENSION_INVALID/,
  );
});

test("BundledExtensionPackage rejects incomplete, extended and symlinked payloads", async (t) => {
  const missingRoot = await createExtension(t, "missing");
  await fs.rm(path.join(missingRoot, "gigacode-extension.json"));
  await assert.rejects(
    loadExtension(missingRoot),
    /BUNDLED_EXTENSION_INVALID.*manifest.*отсутствует/,
  );

  const extendedRoot = await createExtension(t, "extended");
  await fs.appendFile(path.join(extendedRoot, "extension.yaml"), "version: 1\n");
  await assert.rejects(
    loadExtension(extendedRoot),
    /BUNDLED_EXTENSION_INVALID.*содержать только/,
  );

  const symlinkRoot = await createExtension(t, "symlinked");
  const externalManifest = path.join(path.dirname(symlinkRoot), "external-qwen.json");
  t.after(() => fs.rm(externalManifest, { force: true }));
  await fs.writeFile(externalManifest, "{}\n");
  await fs.rm(path.join(symlinkRoot, "qwen-extension.json"));
  await fs.symlink(externalManifest, path.join(symlinkRoot, "qwen-extension.json"));
  await assert.rejects(
    loadExtension(symlinkRoot),
    /BUNDLED_EXTENSION_INVALID.*symlink/,
  );
});

test("Extension payload may declare several simple MCP servers for every Agent", async (t) => {
  const root = await createExtension(t, "multi-mcp");
  const mcpServers = {
    documentation: { command: "docs-mcp", args: ["--stdio"] },
    catalog: { url: "https://mcp.example.test/catalog" },
  };
  await Promise.all([
    fs.writeFile(path.join(root, "qwen-extension.json"), JSON.stringify({
      name: "multi-mcp",
      version: "1.0.0",
      mcpServers,
    })),
    fs.writeFile(path.join(root, "gigacode-extension.json"), JSON.stringify({
      name: "multi-mcp",
      version: "1.0.0",
      mcpServers,
    })),
    fs.writeFile(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers })),
    fs.writeFile(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
      name: "multi-mcp",
      version: "1.0.0",
      mcpServers: "./.mcp.json",
    })),
  ]);

  const extension = await loadExtension(root);
  assert.equal(extension.id, "multi-mcp");
  for (const manifest of ["qwen-extension.json", "gigacode-extension.json", ".mcp.json"]) {
    const value = JSON.parse(await fs.readFile(path.join(root, manifest), "utf8"));
    assert.deepEqual(Object.keys(value.mcpServers), ["documentation", "catalog"]);
  }
});

test("shipped openspec-base owns the complete workflow payload for every Agent", async () => {
  const extension = await loadExtension(OPENSPEC_BASE_ROOT);

  assert.equal(extension.id, "openspec-base");
  assert.deepEqual(extension.manifests, {
    claude: ".claude-plugin/plugin.json",
    qwen: "qwen-extension.json",
    gigacode: "gigacode-extension.json",
  });
  for (const relative of [
    "agent-instructions.md",
    "commands/openspec-base-context.md",
    "commands/openspec-base-intake.md",
    "skills/base-intent/SKILL.md",
    "skills/openspec-base-apply-context/SKILL.md",
    "skills/openspec-base-meta-planning/SKILL.md",
    "skills/openspec-base-test-cases/SKILL.md",
    "subagents/openspec-base-repository-evidence-scout.md",
  ]) {
    assert.equal((await fs.stat(path.join(OPENSPEC_BASE_ROOT, relative))).isFile(), true, relative);
  }
});

test("shipped superpowers is a complete local Extension for every Agent", async () => {
  const extension = await loadExtension(SUPERPOWERS_ROOT);

  assert.equal(extension.id, "superpowers");
  assert.equal(extension.source, "bundled:superpowers");
  assert.deepEqual(extension.manifests, {
    claude: ".claude-plugin/plugin.json",
    qwen: "qwen-extension.json",
    gigacode: "gigacode-extension.json",
  });
  for (const relative of [
    "LICENSE",
    "NOTICE.md",
    "agent-instructions.md",
    "skills/brainstorming/SKILL.md",
    "skills/systematic-debugging/SKILL.md",
    "skills/test-driven-development/SKILL.md",
    "skills/using-superpowers/SKILL.md",
    "skills/verification-before-completion/SKILL.md",
  ]) {
    assert.equal((await fs.stat(path.join(SUPERPOWERS_ROOT, relative))).isFile(), true, relative);
  }
  const notice = await fs.readFile(path.join(SUPERPOWERS_ROOT, "NOTICE.md"), "utf8");
  assert.match(notice, /obra\/superpowers/u);
  assert.match(notice, /v6\.1\.1/u);
});
