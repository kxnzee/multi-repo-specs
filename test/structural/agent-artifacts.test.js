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
const SDK_ROOT = fileURLToPath(new URL("../../packages/plugin-sdk/internal/", import.meta.url));
const PLUGINS_ROOT = fileURLToPath(new URL("../../plugins/", import.meta.url));

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

test("every skill and command is a self-describing standalone artifact", async () => {
  const skillRoot = path.join(EXTENSION_ROOT, "skills");
  for (const entry of await entries(skillRoot)) {
    assert.equal(entry.isDirectory(), true, `skills/${entry.name}`);
    const relative = `skills/${entry.name}/SKILL.md`;
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assert.equal(metadata.name, entry.name, relative);
    assert.equal(typeof metadata.description, "string", relative);
    assert.equal(metadata.description.trim().length > 0, true, relative);
  }

  const commandRoot = path.join(EXTENSION_ROOT, "commands");
  for (const entry of await entries(commandRoot)) {
    assert.equal(entry.isFile() && entry.name.endsWith(".md"), true, `commands/${entry.name}`);
    const relative = `commands/${entry.name}`;
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assert.equal(typeof metadata.description, "string", relative);
    assert.equal(metadata.description.trim().length > 0, true, relative);
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

test("repository evidence delegation keeps one question per subagent invocation", async () => {
  const artifacts = [
    "agent-instructions.md",
    "skills/spec-driven-extended-meta-planning/SKILL.md",
    "subagents/spec-driven-extended-repository-evidence-scout.md",
  ];
  for (const relative of artifacts) {
    const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");
    assert.match(source, /Один вопрос — один новый subagent/u, relative);
    assert.match(source, /пять вопросов — пять subagents/u, relative);
  }

  const globalInstructions = await fs.readFile(
    path.join(EXTENSION_ROOT, "agent-instructions.md"),
    "utf8",
  );
  assert.match(globalInstructions, /Точные содержательные правила бери из `get_change_context`/u);
  assert.doesNotMatch(globalInstructions, /question_id, status, answer и evidence/u);
  assert.doesNotMatch(globalInstructions, /Repository \| Capabilities/u);

  const scout = await fs.readFile(
    path.join(EXTENSION_ROOT, "subagents/spec-driven-extended-repository-evidence-scout.md"),
    "utf8",
  );
  assert.match(scout, /несколько вопросов[\s\S]*`status: blocked`/u);
  assert.match(scout, /Новый или уточнённый вопрос требует нового subagent/u);
  assert.match(scout, /Repository-scoped CodeGraph MCP/u);
  assert.match(scout, /`codegraph_explore`[\s\S]*`projectPath`/u);
  assert.match(scout, /question_id: <переданный question_id>/u);
  assert.match(scout, /status: answered \| partial \| unanswered \| blocked/u);
  assert.match(scout, /answer: <краткий вывод без paths, symbols и code inventory>/u);
  assert.match(scout, /без Markdown и текста до или после него/u);
  const contracts = [...scout.matchAll(/~~~yaml\n([\s\S]*?)\n~~~/gu)]
    .map(([, contract]) => parse(contract));
  assert.equal(contracts.length, 2);
  assert.deepEqual(
    Object.keys(contracts[0].repository_evidence_request),
    ["question_id", "question", "repository_id", "checkout_path", "revision", "anchors"],
  );
  assert.deepEqual(
    Object.keys(contracts[1].repository_evidence),
    ["question_id", "status", "answer", "evidence"],
  );
});

test("Agent gateway instructions defer enforceable policy to MCP", async () => {
  const source = await fs.readFile(path.join(GATEWAY_ROOT, "agent-instructions.md"), "utf8");
  assert.match(source, /get_change_context/u);
  assert.match(source, /get_next_action/u);
  assert.match(source, /report its exact reason and\s+recommended recovery to the user/u);
  assert.match(source, /Do not retry with unchanged input and context/u);
  assert.match(source, /do not emulate it with CLI, Git, file or process\s+tools/u);
  assert.doesNotMatch(source, /receipt|Release|Archive|strict mode|working directory/u);
});

test("Apply context validates repository scope without Plugin-specific routing", async () => {
  const relative = "skills/spec-driven-extended-apply-context/SKILL.md";
  const source = await fs.readFile(path.join(EXTENSION_ROOT, relative), "utf8");

  assert.match(source, /`Repository \| Capabilities`/, relative);
  assert.match(source, /`get_assignment_scope`/u, relative);
  assert.match(source, /Plugin-specific поведение остаётся вне этого skill/iu, relative);
});

test("spec-driven-extended Extension does not route Superspec Changes through another workflow", async () => {
  const source = await fs.readFile(path.join(EXTENSION_ROOT, "agent-instructions.md"), "utf8");
  assert.match(source, /schemaName/u);
  assert.match(source, /только\s+к `spec-driven-extended`/u);
  assert.match(source, /Для `superspec-multirepo`[\s\S]*не добавляй[\s\S]*spec-driven-extended Intake/u);
  assert.match(source, /Это правило не изменяет Superspec Brainstorm/u);
});

test("Default Template artifacts do not depend on concrete Plugins", async () => {
  const forbidden = /change[ -]tracking|change-tracking|result receipt|\bcycle records?\b|\bsnapshot\b|openspec-orch graph|openspec graph/iu;
  for (const root of [EXTENSION_ROOT, TEMPLATE_ROOT]) {
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
