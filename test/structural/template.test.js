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
import { parse, stringify } from "yaml";
import { auditContextLinks } from "../../test-support/context-links.js";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/default/", import.meta.url));
const TEMPLATES_ROOT = fileURLToPath(new URL("../../templates/", import.meta.url));
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

/** Extracts the human acceptance block from schemas that prescribe this gate. */
function featureAcceptanceContract(source) {
  const match = source.match(
    /<!-- FEATURE_ACCEPTANCE_CONTRACT_V1_START -->[\s\S]*?<!-- FEATURE_ACCEPTANCE_CONTRACT_V1_END -->/u,
  );
  assert.ok(match, "Feature Acceptance Contract v1 markers are required");
  return match[0];
}

test("Default Template is copy-only and applies identically for every independent Agent", async (t) => {
  const descriptor = parse(await fs.readFile(path.join(TEMPLATE_ROOT, "template.yaml"), "utf8"));
  assert.deepEqual(Object.keys(descriptor).sort(), ["agentInstructions", "copy", "id", "name", "requires"]);
  assert.equal(descriptor.id, "default");
  assert.deepEqual(descriptor.requires, {
    extensions: ["spec-driven-extended", "superpowers"],
  });
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
    expected.push(agent.instructionsFile);
    expected.sort();
    const plan = await service.plan({ templateRoot: TEMPLATE_ROOT, targetRoot, agent });
    const result = await plan.apply(await plan.inspectPreExistingFiles());

    assert.deepEqual(result.created, expected, agentId);
    assert.deepEqual(result.updated, [], agentId);
    for (const relative of expected) await fs.access(path.join(targetRoot, relative));
    assert.equal(
      await fs.readFile(path.join(targetRoot, agent.instructionsFile), "utf8"),
      await fs.readFile(path.join(TEMPLATE_ROOT, descriptor.agentInstructions), "utf8"),
    );
    for (const other of ["CLAUDE.md", "QWEN.md", "GIGACODE.md"]) {
      if (other !== agent.instructionsFile) {
        await assert.rejects(fs.access(path.join(targetRoot, other)), { code: "ENOENT" });
      }
    }

    const repeated = await service.plan({ templateRoot: TEMPLATE_ROOT, targetRoot, agent });
    assert.deepEqual(
      await repeated.apply(await repeated.inspectPreExistingFiles()),
      { created: [], updated: [] },
      `${agentId}: repeated apply`,
    );
  }
  assert.equal((await expectedTargets(descriptor.copy)).includes(".gitignore"), true);
  assert.equal((await expectedTargets(descriptor.copy)).some((target) => target.startsWith("assets/")), false);
  const gitignore = await fs.readFile(path.join(TEMPLATE_ROOT, "assets/gitignore.template"), "utf8");
  assert.match(gitignore, /^\.gigacode\/tmp\/$/mu);
  assert.match(gitignore, /^\.qwen\/tmp\/$/mu);
  const allowed = /^(?:assets\/(?:gitignore\.template|STORE\.md|agent-instructions\.md)$|context\/|process\/|openspec\/|template\.yaml$)/u;
  for (const relative of await listFiles(TEMPLATE_ROOT)) {
    assert.match(relative, allowed, `Template содержит не copy-only asset: ${relative}`);
  }
});

test("Template installed below target remains safe and cannot overwrite its own source", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-template-nested-"));
  const targetRoot = await fs.realpath(temporary);
  t.after(() => fs.rm(targetRoot, { recursive: true, force: true }));
  const templateRoot = path.join(
    targetRoot,
    "node_modules",
    "openspec-orchestrator",
    "templates",
    "default",
  );
  await fs.mkdir(path.dirname(templateRoot), { recursive: true });
  await fs.cp(TEMPLATE_ROOT, templateRoot, { recursive: true });
  const descriptorPath = path.join(templateRoot, "template.yaml");
  const descriptorSource = await fs.readFile(descriptorPath, "utf8");
  const agentPackage = await BundledAgentPackage.load(path.join(AGENTS_ROOT, "qwen"), {
    expectedId: "qwen",
  });
  const service = new ProjectTemplateService();

  const projectTemplateRoot = path.join(targetRoot, "templates", "default");
  await fs.mkdir(path.dirname(projectTemplateRoot), { recursive: true });
  await fs.cp(TEMPLATE_ROOT, projectTemplateRoot, { recursive: true });
  await assert.rejects(
    service.plan({
      templateRoot: projectTemplateRoot,
      targetRoot,
      agent: agentPackage.definition,
    }),
    (error) => {
      assert.match(error.message, /INIT_TARGET_INVALID/u);
      assert.match(error.message, /Не запускайте openspec-orch init для checkout Orchestrator/u);
      assert.match(
        error.message,
        /openspec-orch init <store-path> --store <store-id> --agent <agent-id>/u,
      );
      return true;
    },
  );

  const plan = await service.plan({
    templateRoot,
    targetRoot,
    agent: agentPackage.definition,
  });
  const result = await plan.apply(await plan.inspectPreExistingFiles());

  assert.equal(result.created.length > 0, true);
  assert.equal(await fs.readFile(descriptorPath, "utf8"), descriptorSource);
  await assert.rejects(
    service.plan({
      templateRoot,
      targetRoot: path.join(templateRoot, "context"),
      agent: agentPackage.definition,
    }),
    /INIT_TARGET_INVALID/u,
  );

  const unsafeDescriptor = parse(descriptorSource);
  unsafeDescriptor.copy = [{
    from: "assets/gitignore.template",
    to: "node_modules/openspec-orchestrator/templates/default/copied",
  }];
  await fs.writeFile(descriptorPath, stringify(unsafeDescriptor), "utf8");
  await assert.rejects(
    service.plan({ templateRoot, targetRoot, agent: agentPackage.definition }),
    /Template не может писать внутрь собственного root/u,
  );
});

test("both configured OpenSpec schemas have closed acyclic artifact graphs", async () => {
  const configuration = parse(
    await fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
  );
  assert.equal(typeof configuration.schema, "string");

  assert.equal(configuration.schema, "spec-driven-extended");
  for (const schemaId of ["spec-driven-extended", "superspec-multirepo"]) {
    const schemaRoot = path.join(TEMPLATE_ROOT, "openspec/schemas", schemaId);
    const schema = parse(await fs.readFile(path.join(schemaRoot, "schema.yaml"), "utf8"));
    assert.deepEqual(
      Object.keys(schema).sort(),
      ["apply", "artifacts", "description", "name", "version"],
      `${schemaId}: unsupported top-level schema fields are ignored by OpenSpec`,
    );
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
  }
});

test("spec-driven-extended adds Verify without a separate Apply artifact", async () => {
  const schemaRoot = path.join(TEMPLATE_ROOT, "openspec/schemas/spec-driven-extended");
  const schema = parse(await fs.readFile(path.join(schemaRoot, "schema.yaml"), "utf8"));
  const intake = await fs.readFile(path.join(schemaRoot, "templates/intake.md"), "utf8");
  const tasks = await fs.readFile(path.join(schemaRoot, "templates/tasks.md"), "utf8");
  const verify = await fs.readFile(path.join(schemaRoot, "templates/verify.md"), "utf8");
  const taskInstruction = schema.artifacts.find(({ id }) => id === "tasks")?.instruction ?? "";

  assert.equal(intake.includes("Verification Expectations"), false);
  assert.equal(schema.artifacts.some(({ id }) => id === "apply"), false);
  assert.equal(schema.artifacts.some(({ generates }) => generates === "apply.md"), false);
  assert.deepEqual(schema.artifacts.find(({ id }) => id === "verify")?.requires, ["tasks"]);
  assert.match(schema.artifacts.find(({ id }) => id === "verify")?.instruction, /openspec-verify-change/u);
  assert.match(verify, /`NOT_APPLICABLE`/u);
  assert.match(taskInstruction, /Human Feature Acceptance belongs.*Verify artifact/su);
  assert.doesNotMatch(tasks, /Ответственный|Получить подтверждение/u);
});

/** Discovers Verify templates by schema declarations and conventional file names. */
async function verificationTemplates() {
  const files = await listFiles(TEMPLATES_ROOT);
  const targets = new Set(files.filter((file) => path.posix.basename(file) === "verify.md"));
  for (const file of files.filter((file) => path.posix.basename(file) === "schema.yaml")) {
    const schema = parse(await fs.readFile(path.join(TEMPLATES_ROOT, file), "utf8"));
    for (const artifact of schema.artifacts ?? []) {
      if (artifact.id !== "verify") continue;
      assert.equal(typeof artifact.template, "string", file);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), "templates", artifact.template));
      assert.ok(files.includes(target), `${file}: missing Verify template ${target}`);
      targets.add(target);
    }
  }
  assert.ok(targets.size > 0, "distribution must contain Verify templates");
  return Promise.all([...targets].sort().map(async (file) => ({
    file,
    source: await fs.readFile(path.join(TEMPLATES_ROOT, file), "utf8"),
  })));
}

test("all Templates and schemas share one scenario verification contract", async () => {
  let canonical;
  for (const { file, source } of await verificationTemplates()) {
    const blocks = [...source.matchAll(
      /<!-- SCENARIO_VERIFICATION_CONTRACT_V1_START -->[\s\S]*?<!-- SCENARIO_VERIFICATION_CONTRACT_V1_END -->/gu,
    )];
    assert.equal(blocks.length, 1, `${file}: exactly one scenario verification contract is required`);
    canonical ??= blocks[0][0];
    assert.equal(blocks[0][0], canonical, `${file}: scenario verification contract drift`);
  }
  assert.match(canonical, /## Краткий вывод агента/u);
  assert.match(
    canonical,
    /\| Сценарий \| Действия проверяющего \| Ожидаемый результат \| Подтверждение агента \| Решение человека \|/u,
  );
  assert.match(canonical, /интерфейс.*API.*баз/isu);
  assert.match(canonical, /не вставляй.*логи/isu);
  assert.doesNotMatch(canonical, /Подтверждение выполненной проверки/u);
});

test("Verify instructions produce a concise human test handoff", async () => {
  const files = (await listFiles(TEMPLATES_ROOT))
    .filter((file) => path.posix.basename(file) === "schema.yaml");
  for (const file of files) {
    const schema = parse(await fs.readFile(path.join(TEMPLATES_ROOT, file), "utf8"));
    const instruction = schema.artifacts?.find(({ id }) => id === "verify")?.instruction;
    if (!instruction) continue;
    assert.match(instruction, /concise verification handoff for a human/u, file);
    assert.match(instruction, /reproducible manual steps/u, file);
    assert.match(instruction, /UI, API or database behavior/u, file);
    assert.match(instruction, /Do not\s+repeat commit lists, branch history, timestamps, raw command output/u, file);
    assert.match(instruction, /one short\s+observation plus a durable link/u, file);
  }
});

test("schemas with a human Feature Acceptance gate share one contract", async () => {
  const templates = (await verificationTemplates()).filter(({ source }) => (
    source.includes("FEATURE_ACCEPTANCE_CONTRACT_V1_START")
  ));
  assert.ok(templates.length > 0);
  const contract = featureAcceptanceContract(templates[0].source);
  for (const { file, source } of templates) {
    assert.equal(featureAcceptanceContract(source), contract, file);
  }
  assert.match(contract, /\*\*Решение:\*\* `PENDING` \/ `PASS` \/ `FAIL`/u);
  assert.match(contract, /Агент готовит выжимку и проверочные кейсы, но решение о приёмке принимает человек/u);
  assert.doesNotMatch(contract, /Responsible participant/u);
  assert.doesNotMatch(contract, /commit|artifact|deployment|timestamp|Verified at/iu);
  assert.doesNotMatch(contract, /PASS_WITH_WARNINGS/u);
});

test("shipped context Markdown links resolve inside its self-contained tree", async () => {
  const report = await auditContextLinks(path.join(TEMPLATE_ROOT, "context"));
  assert.deepEqual(report.diagnostics, []);
  assert.ok(report.checkedLinks > 0, "context must have usable internal navigation");
});

test("superspec-multirepo preserves the complete skill-driven lifecycle", async () => {
  const schemaRoot = path.join(
    TEMPLATE_ROOT,
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
    "verify",
  ]);
  assert.match(schema.artifacts[0].instruction, /superpowers:brainstorming/u);
  assert.match(schema.artifacts.find(({ id }) => id === "plan").instruction, /superpowers:writing-plans/u);
  assert.match(schema.artifacts[0].instruction, /brainstorm\.md/u);
  assert.match(schema.artifacts.find(({ id }) => id === "plan").instruction, /plan\.md/u);
  assert.equal(schema.artifacts.some(({ id }) => id === "apply"), false);
  assert.equal(schema.artifacts.some(({ generates }) => generates === "apply.md"), false);
  assert.deepEqual(schema.artifacts.find(({ id }) => id === "verify").requires, ["plan"]);
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

  const verify = await fs.readFile(path.join(schemaRoot, "templates/verify.md"), "utf8");
  assert.doesNotMatch(verify, /Next step/u);
  await assert.rejects(
    fs.access(path.join(schemaRoot, "templates/apply.md")),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.access(path.join(schemaRoot, "templates/finalize.md")),
    { code: "ENOENT" },
  );

  const tasks = await fs.readFile(path.join(schemaRoot, "templates/tasks.md"), "utf8");
  assert.doesNotMatch(tasks, /Ответственный|Получить подтверждение/u);
});
