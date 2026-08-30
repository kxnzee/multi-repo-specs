/** @fileoverview Независимый structural contract Project Template. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundledAgentPackage,
  BundledAgentProvider,
  ProjectTemplateService,
} from "@openspec-orch/core";
import { parse } from "yaml";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/base/", import.meta.url));
const SUPERSPEC_TEMPLATE_ROOT = fileURLToPath(
  new URL("../../templates/superspec/", import.meta.url),
);
const AGENTS_ROOT = fileURLToPath(new URL("../../agents/", import.meta.url));

/** Возвращает POSIX paths всех обычных файлов ниже directory. */
async function listFiles(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(directory, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

/** Вычисляет ожидаемые target files одной agent mapping без фиксированного inventory. */
async function expectedTargets(copy, templateRoot = TEMPLATE_ROOT) {
  const targets = [];
  for (const operation of copy) {
    const source = path.join(templateRoot, operation.from);
    const stat = await fs.stat(source);
    if (stat.isFile()) {
      targets.push(operation.to);
      continue;
    }
    for (const relative of await listFiles(source)) {
      targets.push(operation.to === "." ? relative : `${operation.to}/${relative}`);
    }
  }
  return targets.sort();
}

/** Проверяет отсутствие циклов в artifact dependency graph. */
function assertAcyclic(artifacts) {
  const dependencies = new Map(artifacts.map(({ id, requires = [] }) => [id, requires]));
  const visiting = new Set();
  const visited = new Set();

  /** Обходит один artifact. */
  function visit(id) {
    if (visited.has(id)) return;
    assert.equal(visiting.has(id), false, `artifact dependency cycle at '${id}'`);
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of dependencies.keys()) visit(id);
}

test("Base Template is copy-only and applies identically for every independent Agent", async (t) => {
  const descriptor = parse(await fs.readFile(path.join(TEMPLATE_ROOT, "template.yaml"), "utf8"));
  assert.deepEqual(Object.keys(descriptor).sort(), ["copy", "id", "name", "requires"]);
  assert.equal(descriptor.id, "base");
  assert.deepEqual(descriptor.requires, { extensions: ["openspec-base"] });
  assert.equal(Object.hasOwn(descriptor, "agents"), false);
  const agentDirectories = (await fs.readdir(AGENTS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const provider = new BundledAgentProvider(await Promise.all(agentDirectories.map(({ name }) => (
    BundledAgentPackage.load(path.join(AGENTS_ROOT, name), { expectedId: name })
  ))));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-template-"));
  const temporaryRoot = await fs.realpath(temporary);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  for (const { id: agentId } of provider.catalog.entries) {
    const targetRoot = path.join(temporaryRoot, agentId);
    await fs.mkdir(targetRoot);
    const expected = await expectedTargets(descriptor.copy);
    const service = new ProjectTemplateService();
    const agent = provider.resolve(agentId);
    const plan = await service.plan({ templateRoot: TEMPLATE_ROOT, targetRoot, agent });
    const result = await plan.apply(await plan.inspectPreExistingFiles());

    assert.deepEqual(result.created, expected, agentId);
    assert.deepEqual(result.updated, [], agentId);
    for (const relative of expected) await fs.access(path.join(targetRoot, relative));

    const repeated = await service.plan({ templateRoot: TEMPLATE_ROOT, targetRoot, agent });
    assert.deepEqual(
      await repeated.apply(await repeated.inspectPreExistingFiles()),
      { created: [], updated: [] },
      `${agentId}: repeated apply`,
    );
  }
  assert.equal((await expectedTargets(descriptor.copy)).includes(".gitignore"), true);
  assert.equal((await expectedTargets(descriptor.copy)).some((target) => target.startsWith("assets/")), false);
  const allowed = /^(?:assets\/gitignore\.template|context\/|openspec\/|template\.yaml$)/u;
  for (const relative of await listFiles(TEMPLATE_ROOT)) {
    assert.match(relative, allowed, `Template содержит не copy-only asset: ${relative}`);
  }
});

test("configured OpenSpec schema has a closed acyclic artifact graph", async () => {
  const configuration = parse(
    await fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
  );
  assert.equal(typeof configuration.schema, "string");

  const schemaRoot = path.join(TEMPLATE_ROOT, "openspec/schemas", configuration.schema);
  const schema = parse(await fs.readFile(path.join(schemaRoot, "schema.yaml"), "utf8"));
  assert.equal(Array.isArray(schema.artifacts), true);
  assert.equal(schema.artifacts.length > 0, true);

  const ids = schema.artifacts.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "artifact IDs must be unique");
  const known = new Set(ids);
  for (const artifact of schema.artifacts) {
    assert.equal(typeof artifact.generates, "string", artifact.id);
    assert.equal(typeof artifact.template, "string", artifact.id);
    await fs.access(path.join(schemaRoot, "templates", artifact.template));
    for (const dependency of artifact.requires ?? []) {
      assert.equal(known.has(dependency), true, `${artifact.id} requires unknown '${dependency}'`);
    }
  }
  for (const dependency of schema.apply?.requires ?? []) {
    assert.equal(known.has(dependency), true, `apply requires unknown '${dependency}'`);
  }
  if (schema.apply?.tracks) {
    assert.equal(
      schema.artifacts.some(({ generates }) => generates === schema.apply.tracks),
      true,
      `apply tracks unknown output '${schema.apply.tracks}'`,
    );
  }
  assertAcyclic(schema.artifacts);
});

test("base-v1 keeps verification as one final external task checkpoint", async () => {
  const schemaRoot = path.join(TEMPLATE_ROOT, "openspec/schemas/base-v1");
  const schema = parse(await fs.readFile(path.join(schemaRoot, "schema.yaml"), "utf8"));
  const intake = await fs.readFile(path.join(schemaRoot, "templates/intake.md"), "utf8");
  const tasks = await fs.readFile(path.join(schemaRoot, "templates/tasks.md"), "utf8");
  const taskInstruction = schema.artifacts.find(({ id }) => id === "tasks")?.instruction ?? "";

  assert.equal(intake.includes("Verification Expectations"), false);
  assert.match(taskInstruction, /Проверка реализованного изменения/);
  assert.equal(tasks.match(/^## \d+\. Проверка реализованного изменения/gmu)?.length, 1);
  assert.equal(
    tasks.match(/^- \[ \] \d+\.\d+ Получить подтверждение, что текущая версия изменения успешно проверена/gmu)?.length,
    1,
  );
});

test("Superspec Template preserves the complete skill-driven lifecycle", async () => {
  const descriptor = parse(
    await fs.readFile(path.join(SUPERSPEC_TEMPLATE_ROOT, "template.yaml"), "utf8"),
  );
  assert.equal(descriptor.id, "superspec");
  assert.deepEqual(Object.keys(descriptor).sort(), ["copy", "id", "name", "requires"]);
  assert.deepEqual(descriptor.requires, { extensions: ["superpowers"] });

  const configuration = parse(
    await fs.readFile(path.join(SUPERSPEC_TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
  );
  assert.equal(configuration.schema, "superspec-multirepo");
  const schemaRoot = path.join(
    SUPERSPEC_TEMPLATE_ROOT,
    "openspec/schemas/superspec-multirepo",
  );
  const schemaSource = await fs.readFile(path.join(schemaRoot, "schema.yaml"), "utf8");
  const schema = parse(schemaSource);
  assert.deepEqual(schema.artifacts.map(({ id }) => id), [
    "brainstorm",
    "proposal",
    "design",
    "specs",
    "tasks",
    "plan",
    "apply",
    "verify",
    "finalize",
  ]);
  assert.match(schema.artifacts[0].instruction, /superpowers:brainstorming/u);
  assert.match(schema.artifacts.find(({ id }) => id === "plan").instruction, /superpowers:writing-plans/u);
  assert.match(schema.artifacts[0].instruction, /brainstorm\.md/u);
  assert.match(schema.artifacts.find(({ id }) => id === "plan").instruction, /plan\.md/u);
  assert.deepEqual(schema.artifacts.find(({ id }) => id === "apply").requires, ["plan"]);
  assert.deepEqual(schema.artifacts.find(({ id }) => id === "verify").requires, ["apply"]);
  assert.deepEqual(schema.artifacts.find(({ id }) => id === "finalize").requires, ["verify"]);
  assert.deepEqual(schema.apply.requires, ["plan"]);
  assert.equal(schema.apply.tracks, "tasks.md");
  for (const skill of [
    "using-superpowers",
    "using-git-worktrees",
    "dispatching-parallel-agents",
    "subagent-driven-development",
    "executing-plans",
    "test-driven-development",
    "systematic-debugging",
    "requesting-code-review",
    "receiving-code-review",
    "verification-before-completion",
    "finishing-a-development-branch",
  ]) {
    assert.match(schemaSource, new RegExp(`superpowers:${skill}`, "u"), skill);
  }
  assert.match(schemaSource, /openspec-verify-change/u);
  assert.doesNotMatch(schemaSource, /Change Tracking|Result Receipt|Snapshot/u);
  assert.match(schemaSource, /Repository ID/u);
  assert.doesNotMatch(
    schemaSource,
    /\bgit\s+(?:add|commit|checkout|pull|merge|push|branch)\b|\bgh\s+pr\b/iu,
  );

  for (const artifact of ["apply", "verify", "finalize"]) {
    await fs.access(path.join(schemaRoot, `templates/${artifact}.md`));
  }

  const tasks = await fs.readFile(path.join(schemaRoot, "templates/tasks.md"), "utf8");
  assert.equal(
    tasks.match(/^- \[ \] \d+\.\d+ Получить подтверждение, что текущая версия изменения успешно проверена/gmu)?.length,
    1,
  );
});

test("Superspec Template applies identically for every independent Agent", async (t) => {
  const descriptor = parse(
    await fs.readFile(path.join(SUPERSPEC_TEMPLATE_ROOT, "template.yaml"), "utf8"),
  );
  const agentDirectories = (await fs.readdir(AGENTS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const provider = new BundledAgentProvider(await Promise.all(agentDirectories.map(({ name }) => (
    BundledAgentPackage.load(path.join(AGENTS_ROOT, name), { expectedId: name })
  ))));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-superspec-template-"));
  const temporaryRoot = await fs.realpath(temporary);
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  for (const { id: agentId } of provider.catalog.entries) {
    const targetRoot = path.join(temporaryRoot, agentId);
    await fs.mkdir(targetRoot);
    const expected = await expectedTargets(descriptor.copy, SUPERSPEC_TEMPLATE_ROOT);
    const plan = await new ProjectTemplateService().plan({
      templateRoot: SUPERSPEC_TEMPLATE_ROOT,
      targetRoot,
      agent: provider.resolve(agentId),
    });
    const result = await plan.apply(await plan.inspectPreExistingFiles());

    assert.deepEqual(result.created, expected, agentId);
    assert.deepEqual(result.updated, [], agentId);
    for (const relative of expected) await fs.access(path.join(targetRoot, relative));
  }
});
