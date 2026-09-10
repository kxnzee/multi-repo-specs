/** @fileoverview Отдельные structural checks skills, commands и subagents Template. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/default/", import.meta.url));
const EXTENSION_ROOT = fileURLToPath(new URL("../../extensions/spec-driven-extended/", import.meta.url));
const GATEWAY_ROOT = fileURLToPath(new URL("../../extensions/orchestrator-agent/", import.meta.url));
const CORE_ROOT = fileURLToPath(new URL("../../packages/core/internal/", import.meta.url));
const MCP_ROOT = fileURLToPath(new URL("../../packages/mcp/lib/", import.meta.url));
const SDK_ROOT = fileURLToPath(new URL("../../packages/plugin-sdk/internal/", import.meta.url));
const PLUGINS_ROOT = fileURLToPath(new URL("../../plugins/", import.meta.url));
const MCP_RUNTIME = fileURLToPath(new URL("../../bin/internal/orchestrator-mcp-runtime.js", import.meta.url));

/** Разбирает обязательный YAML frontmatter Markdown artifact. */
function parseFrontmatter(source, artifact) {
  assert.equal(source.startsWith("---\n"), true, `${artifact}: frontmatter is required`);
  const end = source.indexOf("\n---\n", 4);
  assert.notEqual(end, -1, `${artifact}: frontmatter is not closed`);
  const metadata = parse(source.slice(4, end));
  const body = source.slice(end + 5).trim();
  assert.equal(metadata && typeof metadata === "object", true, artifact);
  assert.equal(body.length > 0, true, `${artifact}: body is empty`);
  return { metadata, body };
}

/** Возвращает отсортированные обычные entries одного directory. */
async function entries(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Возвращает все обычные files ниже directory в стабильном порядке. */
async function files(directory) {
  const result = [];
  for (const entry of await entries(directory)) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

/** Checks that menu metadata remains scalar YAML with optional argument hints. */
function assertMenuMetadata(metadata, artifact) {
  assert.equal(typeof metadata.description, "string", artifact);
  assert.match(metadata.description, /^\[spec-driven-extended\] \S/u, artifact);
  assert.equal(typeof metadata["argument-hint"], "string", artifact);
  assert.match(metadata["argument-hint"], /^\[[^[\]\n]+\](?: \[[^[\]\n]+\])*$/u, artifact);
}

test("every skill and command is a self-describing standalone artifact", async () => {
  const skillRoot = path.join(EXTENSION_ROOT, "skills");
  for (const entry of await entries(skillRoot)) {
    assert.equal(entry.isDirectory(), true, `skills/${entry.name}`);
    const relative = `skills/${entry.name}/SKILL.md`;
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assert.equal(metadata.name, entry.name, relative);
    assertMenuMetadata(metadata, relative);
  }

  const commandRoot = path.join(EXTENSION_ROOT, "commands");
  for (const entry of await entries(commandRoot)) {
    assert.equal(entry.isFile() && entry.name.endsWith(".md"), true, `commands/${entry.name}`);
    const relative = `commands/${entry.name}`;
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assertMenuMetadata(metadata, relative);
  }
});

test("subagent adapters preserve the canonical body and own only provider metadata", async () => {
  const canonicalRoot = path.join(EXTENSION_ROOT, "subagents");
  const canonical = new Map();
  for (const entry of await entries(canonicalRoot)) {
    assert.equal(entry.isFile() && entry.name.endsWith(".md"), true, `subagents/${entry.name}`);
    const relative = `subagents/${entry.name}`;
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    const parsed = parseFrontmatter(source, relative);
    assert.equal(parsed.metadata.name, path.basename(entry.name, ".md"), relative);
    assert.equal(typeof parsed.metadata.description, "string", relative);
    canonical.set(entry.name, parsed.body);
    const nativeRelative = `agents/${entry.name}`;
    const native = parseFrontmatter(
      await fs.readFile(path.join(EXTENSION_ROOT, nativeRelative), "utf8"),
      nativeRelative,
    );
    assert.equal(native.body, parsed.body, nativeRelative);
  }

  const adaptersRoot = path.join(EXTENSION_ROOT, "adapters");
  for (const adapter of await entries(adaptersRoot)) {
    if (!adapter.isDirectory()) continue;
    const subagentsRoot = path.join(adaptersRoot, adapter.name, "subagents");
    for (const entry of await entries(subagentsRoot)) {
      const relative = `adapters/${adapter.name}/subagents/${entry.name}`;
      const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
      const parsed = parseFrontmatter(source, relative);
      assert.equal(canonical.has(entry.name), true, `${relative}: canonical subagent is missing`);
      assert.equal(parsed.metadata.name, path.basename(entry.name, ".md"), relative);
      assert.equal(parsed.body, canonical.get(entry.name), relative);
    }
  }
});

test("scout examples preserve the public request and response fields", async () => {
  const scout = await fs.readFile(
    path.join(EXTENSION_ROOT, "subagents/spec-driven-extended-repository-evidence-scout.md"),
    "utf8",
  );
  const contracts = [...scout.matchAll(/~~~yaml\n([\s\S]*?)\n~~~/gu)]
    .map(([, contract]) => parse(contract));
  assert.equal(contracts.length, 2);
  assert.ok(contracts[0].repository_evidence_request.anchors.length > 0);
  assert.deepEqual(
    Object.keys(contracts[0].repository_evidence_request),
    ["question_id", "question", "repository_id", "checkout_path", "code_navigation", "anchors"],
  );
  assert.deepEqual(
    Object.keys(contracts[1].repository_evidence),
    ["question_id", "status", "answer", "evidence"],
  );
});

test("Default and Initiative artifacts do not depend on concrete Plugins", async () => {
  const forbidden = /codegraph|change[ -]tracking|change-tracking|result receipt|\bcycle records?\b|\bsnapshot\b|openspec-orch graph|openspec[ -]graph|\bget_spec_change_impact\b/iu;
  const initiativeRoots = ["../../extensions/initiative/", "../../templates/initiative/"]
    .map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
  for (const root of [EXTENSION_ROOT, TEMPLATE_ROOT, ...initiativeRoots]) {
    for (const file of await files(root)) {
      const source = await fs.readFile(file, "utf8");
      assert.doesNotMatch(source, forbidden, path.relative(root, file));
    }
  }
});

test("Core, SDK and unrelated Plugins do not know Change Tracking contracts", async () => {
  const forbidden = /change[ -]tracking|@openspec-orch\/plugin-change-tracking|change-tracking-apply-context|result receipt|cycle record/iu;
  const unrelatedPluginFiles = (await files(PLUGINS_ROOT)).filter((file) => (
    !file.startsWith(path.join(PLUGINS_ROOT, "change-tracking", path.sep))
  ));
  for (const file of [
    ...await files(CORE_ROOT),
    ...await files(SDK_ROOT),
    ...unrelatedPluginFiles,
  ]) {
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(source, forbidden, path.relative(fileURLToPath(new URL("../../", import.meta.url)), file));
  }
});

test("OpenSpec Graph integration remains owned by its Plugin", async () => {
  const forbidden = /openspec-graph|OpenSpecGraph|query_graph|get_spec_graph|get_spec_change_impact|graph_impact/iu;
  for (const file of [
    ...await files(CORE_ROOT),
    ...await files(SDK_ROOT),
    ...await files(MCP_ROOT),
    ...await files(GATEWAY_ROOT),
    MCP_RUNTIME,
  ]) {
    const source = await fs.readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      forbidden,
      path.relative(fileURLToPath(new URL("../../", import.meta.url)), file),
    );
  }
});
