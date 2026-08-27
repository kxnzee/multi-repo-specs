/** @fileoverview Отдельные structural checks skills, commands и subagents Template. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/base/", import.meta.url));

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

test("every skill and command is a self-describing standalone artifact", async () => {
  const skillRoot = path.join(TEMPLATE_ROOT, "skills");
  for (const entry of await entries(skillRoot)) {
    assert.equal(entry.isDirectory(), true, `skills/${entry.name}`);
    const relative = `skills/${entry.name}/SKILL.md`;
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assert.equal(metadata.name, entry.name, relative);
    assert.equal(typeof metadata.description, "string", relative);
    assert.equal(metadata.description.trim().length > 0, true, relative);
  }

  const commandRoot = path.join(TEMPLATE_ROOT, "commands");
  for (const entry of await entries(commandRoot)) {
    assert.equal(entry.isFile() && entry.name.endsWith(".md"), true, `commands/${entry.name}`);
    const relative = `commands/${entry.name}`;
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
    const { metadata } = parseFrontmatter(source, relative);
    assert.equal(typeof metadata.description, "string", relative);
    assert.equal(metadata.description.trim().length > 0, true, relative);
  }
});

test("subagent adapters preserve the canonical body and own only provider metadata", async () => {
  const canonicalRoot = path.join(TEMPLATE_ROOT, "subagents");
  const canonical = new Map();
  for (const entry of await entries(canonicalRoot)) {
    assert.equal(entry.isFile() && entry.name.endsWith(".md"), true, `subagents/${entry.name}`);
    const relative = `subagents/${entry.name}`;
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
    const parsed = parseFrontmatter(source, relative);
    assert.equal(parsed.metadata.name, path.basename(entry.name, ".md"), relative);
    assert.equal(typeof parsed.metadata.description, "string", relative);
    canonical.set(entry.name, parsed.body);
  }

  const adaptersRoot = path.join(TEMPLATE_ROOT, "adapters");
  for (const adapter of await entries(adaptersRoot)) {
    if (!adapter.isDirectory()) continue;
    const subagentsRoot = path.join(adaptersRoot, adapter.name, "subagents");
    for (const entry of await entries(subagentsRoot)) {
      const relative = `adapters/${adapter.name}/subagents/${entry.name}`;
      const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
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
    "skills/openspec-base-meta-planning/SKILL.md",
    "subagents/openspec-base-repository-evidence-scout.md",
  ];
  for (const relative of artifacts) {
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
    assert.match(source, /Один вопрос — один новый subagent/u, relative);
    assert.match(source, /пять вопросов — пять subagents/u, relative);
  }

  const scout = await fs.readFile(
    path.join(TEMPLATE_ROOT, "subagents/openspec-base-repository-evidence-scout.md"),
    "utf8",
  );
  assert.match(scout, /несколько вопросов[\s\S]*`status: blocked`/u);
  assert.match(scout, /Новый или уточнённый вопрос требует нового subagent/u);
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

test("Apply context uses the stateless OpenSpec Graph inspection contract", async () => {
  const relative = "skills/openspec-base-apply-context/SKILL.md";
  const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");

  assert.match(source, /`openspec-orch graph inspect --json`/, relative);
  assert.match(source, /`errors: 0`/, relative);
  assert.match(source, /`Repository \| Capabilities`/, relative);
  assert.doesNotMatch(source, /graph check-scope/u, relative);
  assert.doesNotMatch(source, /missing_required_repositories/u, relative);
});

test("Base agent artifacts do not reference the removed OpenSpec Graph lifecycle", async () => {
  const artifacts = [
    "agent-instructions.md",
    "openspec/config.yaml",
    "skills/openspec-base-apply-context/SKILL.md",
    "skills/openspec-base-meta-planning/SKILL.md",
  ];
  const removedContract = /graph (?:build|status|impact|check-scope|sync)|graph_phase|scope_check|stale \| unavailable/iu;

  for (const relative of artifacts) {
    const source = await fs.readFile(path.join(TEMPLATE_ROOT, relative), "utf8");
    assert.doesNotMatch(source, removedContract, relative);
  }

  const metaPlanning = await fs.readFile(
    path.join(TEMPLATE_ROOT, "skills/openspec-base-meta-planning/SKILL.md"),
    "utf8",
  );
  assert.match(metaPlanning, /graph_check: not_run \| ready \| invalid \| not_configured/u);
  assert.match(metaPlanning, /scope_status: not_applicable \| ready \| invalid/u);
});
