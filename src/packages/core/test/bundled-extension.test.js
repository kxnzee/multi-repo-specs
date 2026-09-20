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

import { createDirectoryLink } from "../fixtures/filesystem.js";

const SPEC_DRIVEN_EXTENDED_ROOT = fileURLToPath(
  new URL("../../../../extensions/spec-driven-extended/", import.meta.url),
);
const PROJECT_CONTEXT_ROOT = fileURLToPath(
  new URL("../../../../extensions/project-context/", import.meta.url),
);
const SUPERPOWERS_ROOT = fileURLToPath(
  new URL("../../../../extensions/superpowers/", import.meta.url),
);
const ORCHESTRATOR_AGENT_ROOT = fileURLToPath(
  new URL("../../../../extensions/orchestrator-agent/", import.meta.url),
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
  const resolved = provider.resolve({ id: "workflow" });
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
  const distributionOnly = new BundledExtensionProvider([extensionPackage], {
    catalogExcludeIds: ["workflow"],
  });
  assert.deepEqual(distributionOnly.catalog.entries, []);
  assert.equal(
    distributionOnly.resolve({ id: "workflow" }).id,
    "workflow",
  );
  assert.throws(
    () => new BundledExtensionProvider([extensionPackage], {
      catalogExcludeIds: ["unknown"],
    }),
    /catalogExcludeIds содержит неизвестный/u,
  );
  assert.throws(
    () => provider.resolve({ id: "missing" }),
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
  const externalManifestRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openspec-external-extension-manifest-"),
  );
  t.after(() => fs.rm(externalManifestRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(externalManifestRoot, "plugin.json"), "{}\n");
  await fs.rm(path.join(symlinkRoot, ".claude-plugin"), { recursive: true });
  await createDirectoryLink(externalManifestRoot, path.join(symlinkRoot, ".claude-plugin"));
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

test("shipped project-context owns schema-independent context collection", async () => {
  const extension = await loadExtension(PROJECT_CONTEXT_ROOT);

  assert.equal(extension.id, "project-context");
  assert.deepEqual(extension.targets, ["store"]);
  for (const relative of [
    "agent-instructions.md",
    "commands/project-context.md",
  ]) {
    assert.equal((await fs.stat(path.join(PROJECT_CONTEXT_ROOT, relative))).isFile(), true, relative);
  }
});

test("shipped spec-driven-extended owns the schema workflow payload for every Agent", async () => {
  const extension = await loadExtension(SPEC_DRIVEN_EXTENDED_ROOT);

  assert.equal(extension.id, "spec-driven-extended");
  assert.deepEqual(extension.manifests, {
    claude: ".claude-plugin/plugin.json",
    qwen: "qwen-extension.json",
    gigacode: "gigacode-extension.json",
  });
  for (const relative of [
    "agent-instructions.md",
    "skills/spec-driven-extended-intake/SKILL.md",
    "skills/spec-driven-extended-intent/SKILL.md",
    "skills/spec-driven-extended-apply-context/SKILL.md",
    "skills/spec-driven-extended-meta-planning/SKILL.md",
    "skills/spec-driven-extended-test-cases/SKILL.md",
    "subagents/spec-driven-extended-repository-evidence-scout.md",
  ]) {
    assert.equal((await fs.stat(path.join(SPEC_DRIVEN_EXTENDED_ROOT, relative))).isFile(), true, relative);
  }
});

test("spec-driven-extended leaves Change creation and workflow start to OpenSpec", async () => {
  const [instructions, intakeSkill] = await Promise.all([
    fs.readFile(path.join(SPEC_DRIVEN_EXTENDED_ROOT, "agent-instructions.md"), "utf8"),
    fs.readFile(
      path.join(SPEC_DRIVEN_EXTENDED_ROOT, "skills/spec-driven-extended-intake/SKILL.md"),
      "utf8",
    ),
  ]);

  assert.match(instructions, /openspec new change <change-id> --schema spec-driven-extended/u);
  assert.match(instructions, /После создания продолжай штатной командой OpenSpec/u);
  assert.match(intakeSkill, /ЗАПРЕЩЕНО создавать Change или выполнять `openspec new change`/u);
  assert.match(intakeSkill, /BLOCKER: CHANGE_NOT_FOUND/u);
  assert.doesNotMatch(intakeSkill, /BLOCKER: INTAKE_NOT_FOUND/u);
  assert.doesNotMatch(intakeSkill, /и создай Change штатной командой/u);
});

test("spec-driven-extended blocks Store sessions before Apply writes", async () => {
  const applyContext = await fs.readFile(
    path.join(SPEC_DRIVEN_EXTENDED_ROOT, "skills/spec-driven-extended-apply-context/SKILL.md"),
    "utf8",
  );

  assert.match(applyContext, /`current_assignment\.role: store` блокирует Apply/u);
  assert.match(applyContext, /Не предлагай расширить файловые разрешения\s+Store-сессии/u);
  assert.doesNotMatch(applyContext, /Для Store-level координации передать исходный набор Tasks/u);
});

test("shipped orchestrator-agent exposes the same governed MCP to every Agent", async () => {
  const extension = await loadExtension(ORCHESTRATOR_AGENT_ROOT);

  assert.equal(extension.id, "orchestrator-agent");
  const claudePlugin = JSON.parse(await fs.readFile(
    path.join(ORCHESTRATOR_AGENT_ROOT, ".claude-plugin/plugin.json"),
    "utf8",
  ));
  const claudeMcp = JSON.parse(await fs.readFile(
    path.join(ORCHESTRATOR_AGENT_ROOT, ".mcp.json"),
    "utf8",
  ));
  const qwen = JSON.parse(await fs.readFile(
    path.join(ORCHESTRATOR_AGENT_ROOT, "qwen-extension.json"),
    "utf8",
  ));
  const gigacode = JSON.parse(await fs.readFile(
    path.join(ORCHESTRATOR_AGENT_ROOT, "gigacode-extension.json"),
    "utf8",
  ));
  assert.equal(claudePlugin.mcpServers, "./.mcp.json");
  for (const manifest of [claudeMcp, qwen, gigacode]) {
    assert.deepEqual(Object.keys(manifest.mcpServers), ["openspec-orchestrator"]);
    assert.equal(manifest.mcpServers["openspec-orchestrator"].command, "openspec-orch-mcp");
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
