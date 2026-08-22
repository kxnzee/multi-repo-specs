/** @fileoverview Контракт и security-проверки общего Project Template engine. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { parse, stringify } from "yaml";

import {
  BASE_TEMPLATE_ROOT,
  buildTemplatePlan,
  parseTemplateDescriptor,
} from "../src/internal/template/index.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

const BASE_TEMPLATE_DESCRIPTOR = parseTemplateDescriptor(
  await fs.readFile(path.join(BASE_TEMPLATE_ROOT, "template.yaml"), "utf8"),
);
const BASE_AGENT_IDS = Object.freeze(Object.keys(BASE_TEMPLATE_DESCRIPTOR.agents).sort());
const DIRECTORY_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

/**
 * Создаёт изолированные Template и target roots.
 *
 * @param {import("node:test").TestContext} t Test context.
 * @returns {Promise<{root: string, templateRoot: string, targetRoot: string}>} Пути сценария.
 */
async function temporaryRoots(t) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-template-");
  const templateRoot = path.join(root, "template");
  const targetRoot = path.join(root, "target");
  await fs.mkdir(templateRoot);
  await fs.mkdir(targetRoot);
  return { root, templateRoot, targetRoot };
}

/**
 * Возвращает минимальный descriptor одного агента.
 *
 * @param {Array<{from: string, to: string}>} copy Операции copy.
 * @returns {Record<string, unknown>} YAML-значение.
 */
function descriptorValue(copy) {
  return {
    agents: {
      test: {
        openspec_adapter: "test-adapter",
        generated_directory: ".generated",
        target_directory: ".agent",
        commands_directory: ".agent/commands",
        instructions_file: ".agent/INSTRUCTIONS.md",
        copy,
      },
    },
  };
}

/**
 * Записывает descriptor сценария.
 *
 * @param {string} templateRoot Template root.
 * @param {Record<string, unknown>} value YAML-значение.
 * @returns {Promise<void>}
 */
async function writeDescriptor(templateRoot, value) {
  await fs.writeFile(path.join(templateRoot, "template.yaml"), stringify(value), "utf8");
}

test("built-in and local Templates use one planner without writing target files", async (t) => {
  const { templateRoot, targetRoot } = await temporaryRoots(t);
  const localValue = descriptorValue([{ from: "instruction.md", to: ".agent/INSTRUCTIONS.md" }]);
  await writeDescriptor(templateRoot, localValue);
  await fs.writeFile(path.join(templateRoot, "instruction.md"), "Local instructions.\n", "utf8");

  const local = await buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" });
  assert.deepEqual(local.supportedAgentIds, ["test"]);
  assert.deepEqual(local.files.map(({ targetRelative }) => targetRelative), [
    ".agent/INSTRUCTIONS.md",
  ]);

  for (const agentId of BASE_AGENT_IDS) {
    const builtIn = await buildTemplatePlan({
      templateRoot: BASE_TEMPLATE_ROOT,
      targetRoot,
      agentId,
    });
    assert.deepEqual(builtIn.supportedAgentIds, BASE_AGENT_IDS);
    assert.equal(
      builtIn.files.some(({ targetRelative }) => targetRelative === builtIn.agent.instructionsFile),
      true,
      agentId,
    );
  }
  assert.deepEqual(await fs.readdir(targetRoot), []);
});

test("every base mapping installs the complete canonical agent contract", async (t) => {
  const { targetRoot } = await temporaryRoots(t);
  const skillFiles = (await fs.readdir(path.join(BASE_TEMPLATE_ROOT, "skills")))
    .map((name) => `${name}/SKILL.md`)
    .sort();
  const commandFiles = (await fs.readdir(path.join(BASE_TEMPLATE_ROOT, "commands"))).sort();
  const subagentFiles = (await fs.readdir(path.join(BASE_TEMPLATE_ROOT, "subagents"))).sort();

  for (const agentId of BASE_AGENT_IDS) {
    const builtIn = await buildTemplatePlan({
      templateRoot: BASE_TEMPLATE_ROOT,
      targetRoot,
      agentId,
    });
    const targets = new Set(builtIn.files.map(({ targetRelative }) => targetRelative));
    const projectCommandsCopy = builtIn.agent.copy.find(({ from }) => from === "commands");
    assert.ok(projectCommandsCopy, `${agentId}: project commands copy`);
    for (const relativePath of skillFiles) {
      assert.equal(
        targets.has(path.posix.join(builtIn.agent.targetDirectory, "skills", relativePath)),
        true,
        `${agentId}: ${relativePath}`,
      );
    }
    for (const relativePath of commandFiles) {
      assert.equal(
        targets.has(path.posix.join(projectCommandsCopy.to, relativePath)),
        true,
        `${agentId}: ${relativePath}`,
      );
    }
    for (const filename of subagentFiles) {
      assert.equal(
        targets.has(path.posix.join(builtIn.agent.targetDirectory, "agents", filename)),
        true,
        `${agentId}: ${filename}`,
      );
    }
    assert.equal(targets.has(builtIn.agent.instructionsFile), true, agentId);
  }
});

test("base mappings reuse canonical sources and isolate only necessary adaptations", () => {
  for (const agentId of BASE_AGENT_IDS) {
    const agent = BASE_TEMPLATE_DESCRIPTOR.agents[agentId];
    assert.deepEqual(
      agent.copy.find(({ to }) => to === agent.instructionsFile),
      { from: "agent-instructions.md", to: agent.instructionsFile },
      agentId,
    );
    assert.deepEqual(
      agent.copy.find(({ to }) => to === path.posix.join(agent.targetDirectory, "skills")),
      { from: "skills", to: path.posix.join(agent.targetDirectory, "skills") },
      agentId,
    );
    const expectedProjectCommandsDirectory = agentId === "claude"
      ? path.posix.dirname(agent.commandsDirectory)
      : agent.commandsDirectory;
    assert.deepEqual(agent.copy.find(({ from }) => from === "commands"), {
      from: "commands",
      to: expectedProjectCommandsDirectory,
    }, agentId);
    const subagents = agent.copy.find(
      ({ to }) => to === path.posix.join(agent.targetDirectory, "agents"),
    );
    assert.ok(subagents, agentId);
    assert.equal(
      subagents.from === "subagents" ||
        subagents.from === path.posix.join("adapters", agentId, "subagents"),
      true,
      agentId,
    );
  }
});

test("supported-agent documentation matches the Template registry", async () => {
  const documentation = await fs.readFile(
    new URL("../docs/user/supported-agents.md", import.meta.url),
    "utf8",
  );
  const documentedIds = [...documentation.matchAll(/^\| `([a-z][a-z0-9-]*)` \|/gm)]
    .map(([, id]) => id)
    .sort();
  assert.deepEqual(documentedIds, BASE_AGENT_IDS);
});

test("base context command is shipped as provider-native operation", async () => {
  const command = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "commands", "openspec-base-context.md"),
    "utf8",
  );

  assert.match(command, /^---\ndescription: .+context/im);
  assert.match(command, /\/openspec-base-context/);
  assert.match(command, /openspec\/context/);
  assert.match(command, /Не изменять встроенные OpenSpec `openspec-\*` навыки и `opsx-\*` команды/);
  assert.match(command, /`context_status: updated`/);

  for (const legacyDependency of [
    "sdd.yaml",
    ".sdd/",
    "sdd.",
    "CODEOWNERS",
    "Work Package",
  ]) {
    assert.equal(command.includes(legacyDependency), false, legacyDependency);
  }
});

test("base OpenSpec config adds native planning rules without changing schema", async () => {
  const config = parse(
    await fs.readFile(path.join(BASE_TEMPLATE_ROOT, "openspec", "config.yaml"), "utf8"),
  );

  assert.equal(config.schema, "spec-driven");
  assert.match(config.context, /openspec\/context\/00-start-here\.md/);
  assert.match(config.context, /openspec-orch\.yaml/);
  assert.match(config.context, /openspec-base-apply-context/);
  assert.match(config.context, /CYCLE_NOT_FOUND/);
  assert.match(config.context, /standard OpenSpec Apply без Orchestrator/);
  assert.match(config.context, /другие ошибки не превращай в fallback/);
  assert.match(config.context, /Встроенный openspec-apply-change\s+остаётся\s+владельцем workflow/);
  assert.deepEqual(Object.keys(config.rules).sort(), ["design", "proposal", "specs", "tasks"]);
  assert.match(config.rules.proposal.join("\n"), /не создавать отдельный questionnaire-файл/i);
  assert.match(config.rules.proposal.join("\n"), /Repository impact/);
  assert.match(config.rules.proposal.join("\n"), /openspec-base-meta-planning.*proposal/i);
  assert.match(config.rules.specs.join("\n"), /<change-id>-<index>/);
  assert.match(config.rules.specs.join("\n"), /add-profile-contacts-001/);
  assert.match(config.rules.specs.join("\n"), /Не делить Requirements и Scenarios по репозиториям/);
  assert.match(config.rules.specs.join("\n"), /openspec-base-meta-planning.*specs/i);
  assert.match(config.rules.design.join("\n"), /Repository implementation map/);
  assert.match(config.rules.design.join("\n"), /openspec-base-meta-planning.*design/i);
  assert.match(config.rules.tasks.join("\n"), /repository-id/);
  assert.match(config.rules.tasks.join("\n"), /primary solution owner/);
  assert.match(config.rules.tasks.join("\n"), /openspec-base-meta-planning.*tasks/i);
  assert.equal(JSON.stringify(config).includes("sdd"), false);
});

test("base agent instructions keep standard Apply available when no Cycle exists", async () => {
  const instructions = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "agent-instructions.md"),
    "utf8",
  );

  assert.match(instructions, /Только при `CYCLE_NOT_FOUND`/);
  assert.match(instructions, /standard\s+OpenSpec Apply без Orchestrator/s);
  assert.match(instructions, /либо создание Cycle/);
});

test("base context keeps repository-local technical context outside the Store", async () => {
  const systemMapSource = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "context", "system-map.yaml"),
    "utf8",
  );
  const systemMap = parse(systemMapSource);
  const startHere = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "context", "00-start-here.md"),
    "utf8",
  );
  const command = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "commands", "openspec-base-context.md"),
    "utf8",
  );
  const architecture = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "context", "03-architecture.md"),
    "utf8",
  );
  const qualityGates = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "context", "07-quality-gates.md"),
    "utf8",
  );

  assert.equal(systemMap.version, 2);
  assert.deepEqual(systemMap.repositories, []);
  assert.deepEqual(systemMap.systems, []);
  assert.deepEqual(systemMap.relationships, []);
  assert.match(systemMapSource, /source, relation, target/);
  assert.match(systemMapSource, /implemented_by: system -> repository/);
  assert.match(systemMapSource, /system:<systems\[\]\.id>/);
  assert.match(systemMapSource, /repository:<repositories\[\]\.id>/);
  assert.match(startHere, /локальное техническое устройство.*только в самих Code\s+Repositories/s);
  assert.match(command, /Не создавать `openspec\/context\/repositories\/`/);
  assert.match(command, /локальный технический контекст одного репозитория → без записи в Store/);
  assert.match(command, /source → relation → target/);
  assert.match(command, /from\/to\/type.*не интерпретировать/s);
  assert.match(architecture, /Межсистемные ограничения и инварианты/);
  assert.doesNotMatch(architecture, /устойчивые технические условия/);
  assert.match(qualityGates, /Локальные команды build\/test\/lint/);
  assert.doesNotMatch(qualityGates, /Команда или источник/);
  await assert.rejects(
    fs.stat(path.join(BASE_TEMPLATE_ROOT, "context", "repositories")),
    { code: "ENOENT" },
  );
});

test("base Template has one read-only planning meta-skill", async () => {
  const skillDirectories = (await fs.readdir(path.join(BASE_TEMPLATE_ROOT, "skills"))).sort();
  assert.deepEqual(skillDirectories, [
    "base-intent",
    "openspec-base-apply-context",
    "openspec-base-meta-planning",
    "openspec-base-test-cases",
  ]);

  const name = "openspec-base-meta-planning";
  const skill = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "skills", name, "SKILL.md"),
    "utf8",
  );
  const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatterMatch);
  const frontmatter = parse(frontmatterMatch[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ["description", "name"]);
  assert.equal(frontmatter.name, name);
  assert.match(frontmatter.description, /[А-Яа-яЁё]/);
  assert.match(skill, /Работать только на чтение/);
  assert.match(skill, /единственным project meta-skill/);
  assert.match(skill, /Не вызывать `openspec-base-meta-planning` рекурсивно/);
  assert.equal(skill.includes("sdd.yaml"), false);
  assert.equal(skill.includes("Work Package"), false);
});

test("base planning meta-skill routes artifact stages without changing the OpenSpec workflow", async () => {
  const skill = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "skills", "openspec-base-meta-planning", "SKILL.md"),
    "utf8",
  );

  for (const stage of ["proposal", "specs", "design", "tasks", "impact-review", "planning-review"]) {
    assert.match(skill, new RegExp(`\\b${stage}\\b`, "i"), stage);
  }
  for (const dependency of [
    "openspec-base-test-cases",
    "openspec-base-project-context-researcher",
    "openspec-base-planning-reviewer",
    "openspec-base-repository-evidence-scout",
  ]) {
    assert.match(skill, new RegExp(`\\b${dependency}\\b`), dependency);
  }
  assert.match(skill, /check_status: ready \| needs_revision \| blocked/);
  assert.match(skill, /Не изменять schema/);
  assert.match(skill, /Не считать результат approval, Gate/);
});

test("base apply context scopes the built-in Apply to the current Cycle repository", async () => {
  const skill = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "skills", "openspec-base-apply-context", "SKILL.md"),
    "utf8",
  );
  const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatterMatch);
  const frontmatter = parse(frontmatterMatch[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ["description", "name"]);
  assert.equal(frontmatter.name, "openspec-base-apply-context");
  assert.match(skill, /openspec-orch status.*--json/s);
  assert.match(skill, /только ошибка `CYCLE_NOT_FOUND`/);
  assert.match(skill, /любая другая ошибка.*статусом `blocked`/s);
  assert.match(skill, /Standard OpenSpec Apply/);
  assert.match(skill, /mode: standard[\s\S]*orchestration: disabled/);
  assert.match(skill, /не создавать фиктивные Receipts/);
  assert.match(skill, /не предлагать `record assignment` или `verify`/);
  assert.match(skill, /Если Cycle существует, не предлагать standard-режим как обход/);
  assert.match(skill, /current_repository\.in_cycle/);
  assert.match(skill, /exact.*progress-only.*drift/s);
  assert.match(skill, /полный файл.*contextFiles\.tasks/s);
  assert.match(skill, /primary solution owner/);
  assert.match(skill, /Evidence gate для checkbox/);
  assert.match(skill, /task_evidence:[\s\S]*status: satisfied \| blocked/);
  assert.match(skill, /test-файл в текущем diff/);
  assert.match(skill, /Отсутствие test-инфраструктуры[\s\S]*status: blocked/);
  assert.match(skill, /не заменять тест рассуждением/);
  assert.match(skill, /mode: orchestrated[\s\S]*planning_revision/);
  assert.match(skill, /repository_completion:[\s\S]*completion_status: completed \| incomplete/);
  assert.match(skill, /не предлагать[\s\S]*status: completed/);
  assert.match(skill, /Не запускать полный штатный OpenSpec Verify после каждого checkbox/);
  assert.match(skill, /Не создавать новый\s+implementation workflow/s);
  assert.match(skill, /не изменять встроенные `openspec-\*`\s+skills или `opsx-\*`/);
});

test("base planning meta-skill checks repository coverage without creating another workflow", async () => {
  const skill = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "skills", "openspec-base-meta-planning", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /заявленные `repository-id`.*обоснованные `no-change`/s);
  assert.match(skill, /Proposal impact → Design map → Tasks →\s+verification plan/s);
  assert.match(skill, /симметричность межрепозиторных изменений/);
  assert.match(skill, /`openspec-base-planning-reviewer`/);
  assert.match(skill, /Отсутствие subagent само\s+по себе не блокирует проверку/);
});

test("base test-case skill is Russian and does not introduce another OpenSpec workflow", async () => {
  const skill = await fs.readFile(
    path.join(BASE_TEMPLATE_ROOT, "skills", "openspec-base-test-cases", "SKILL.md"),
    "utf8",
  );

  assert.match(skill, /^name: openspec-base-test-cases$/m);
  assert.match(skill, /^description: [А-ЯЁ]/m);
  assert.match(skill, /openspec status --change/);
  assert.match(skill, /По умолчанию выводить список в ответе/);
  assert.match(skill, /не добавлять нештатный файл в Change/);
  assert.match(skill, /нейтральные записи/);
  assert.match(skill, /repository_ids/);
  assert.match(skill, /не угадывать CSV\/API-схему/i);

  for (const forbiddenDependency of ["sdd.yaml", ".sdd/", "CODEOWNERS", "Work Package"] ) {
    assert.equal(skill.includes(forbiddenDependency), false, forbiddenDependency);
  }
});

test("base subagents are Russian read-only native profiles", async () => {
  const expectedNames = [
    "openspec-base-planning-reviewer",
    "openspec-base-project-context-researcher",
    "openspec-base-repository-evidence-scout",
  ];
  const commonReadOnlyTools = [
    "read_file",
    "read_many_files",
    "grep_search",
    "glob",
    "list_directory",
  ];
  for (const name of expectedNames) {
    const contents = await fs.readFile(
      path.join(BASE_TEMPLATE_ROOT, "subagents", `${name}.md`),
      "utf8",
    );
    const frontmatterMatch = contents.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch, name);
    const frontmatter = parse(frontmatterMatch[1]);
    assert.equal(frontmatter.name, name);
    assert.match(frontmatter.name, /^openspec-base-/);
    assert.match(frontmatter.description, /[А-Яа-яЁё]/);
    assert.equal(frontmatter.model, "inherit");
    assert.equal(frontmatter.approvalMode, "plan");
    assert.deepEqual(frontmatter.tools, commonReadOnlyTools);
    assert.match(contents, /Верни по-русски/);
    assert.match(contents, /Ты OpenSpec-сабагент/);
    assert.doesNotMatch(contents, /code\s*graph/i);

    for (const forbiddenTool of ["write_file", "edit", "run_shell_command", "\n  - agent\n"]) {
      assert.equal(contents.includes(forbiddenTool), false, `${name}: ${forbiddenTool}`);
    }
  }
});

test("adapted subagents preserve canonical names, descriptions and bodies", async () => {
  const adaptersRoot = path.join(BASE_TEMPLATE_ROOT, "adapters");
  const adapterIds = await fs.readdir(adaptersRoot);

  for (const adapterId of adapterIds) {
    assert.ok(BASE_TEMPLATE_DESCRIPTOR.agents[adapterId], adapterId);
    const subagentsRoot = path.join(adaptersRoot, adapterId, "subagents");
    const filenames = await fs.readdir(subagentsRoot);
    for (const filename of filenames) {
      const canonical = await fs.readFile(
        path.join(BASE_TEMPLATE_ROOT, "subagents", filename),
        "utf8",
      );
      const adapted = await fs.readFile(path.join(subagentsRoot, filename), "utf8");
      const canonicalMatch = canonical.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const adaptedMatch = adapted.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      assert.ok(canonicalMatch, `canonical: ${filename}`);
      assert.ok(adaptedMatch, `${adapterId}: ${filename}`);
      const canonicalFrontmatter = parse(canonicalMatch[1]);
      const adaptedFrontmatter = parse(adaptedMatch[1]);
      assert.equal(adaptedFrontmatter.name, canonicalFrontmatter.name, `${adapterId}: ${filename}`);
      assert.equal(
        adaptedFrontmatter.description,
        canonicalFrontmatter.description,
        `${adapterId}: ${filename}`,
      );
      assert.equal(adaptedMatch[2], canonicalMatch[2], `${adapterId}: ${filename}`);
    }
  }
});

test("copy plan preserves operation order, overrides and executable mode", async (t) => {
  const { templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(
    templateRoot,
    descriptorValue([
      { from: "base", to: "assets" },
      { from: "override.txt", to: "assets/config.txt" },
    ]),
  );
  await fs.mkdir(path.join(templateRoot, "base", "nested"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "base", "config.txt"), "base\n", "utf8");
  const executable = path.join(templateRoot, "base", "nested", "run.sh");
  await fs.writeFile(executable, "#!/bin/sh\n", "utf8");
  await fs.chmod(executable, 0o755);
  const sourceMode = (await fs.stat(executable)).mode & 0o777;
  await fs.writeFile(path.join(templateRoot, "override.txt"), "override\n", "utf8");

  const result = await buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" });
  assert.deepEqual(result.files.map(({ targetRelative, operationIndex }) => [
    targetRelative,
    operationIndex,
  ]), [
    ["assets/config.txt", 0],
    ["assets/nested/run.sh", 0],
    ["assets/config.txt", 1],
  ]);
  assert.equal(
    result.files.find(({ targetRelative }) => targetRelative.endsWith("run.sh")).mode,
    sourceMode,
  );
  if (process.platform !== "win32") assert.equal(sourceMode, 0o755);
});

test("descriptor rejects missing fields and unsafe portable paths", () => {
  assert.throws(() => parseTemplateDescriptor("agents: {}\n"), /непустой agents/);
  assert.throws(() => parseTemplateDescriptor("agents:\n  Test: {}\n"), /lowercase kebab-case/);

  for (const unsafePath of ["../outside", "/absolute", "nested//file", "./file", "C:\\temp"] ) {
    const value = descriptorValue([{ from: unsafePath, to: "." }]);
    assert.throws(() => parseTemplateDescriptor(stringify(value)), /относительным POSIX-путём/);
  }

  const nestedRoots = descriptorValue([]);
  nestedRoots.agents.test.target_directory = ".generated/nested";
  assert.throws(
    () => parseTemplateDescriptor(stringify(nestedRoots)),
    /generated_directory и target_directory/,
  );
});

test("descriptor rejects unknown fields instead of silently ignoring authoring mistakes", () => {
  const topLevel = descriptorValue([]);
  topLevel.description = "unsupported metadata";
  assert.throws(
    () => parseTemplateDescriptor(stringify(topLevel)),
    /description/,
  );

  const agent = descriptorValue([]);
  agent.agents.test.handofs = { apply: ".agent/commands/apply.md" };
  assert.throws(
    () => parseTemplateDescriptor(stringify(agent)),
    /handofs/,
  );

  const copy = descriptorValue([{ from: "instruction.md", to: ".agent/INSTRUCTIONS.md" }]);
  copy.agents.test.copy[0].overwrite = true;
  assert.throws(
    () => parseTemplateDescriptor(stringify(copy)),
    /overwrite/,
  );
});

test("planner rejects an agent absent from the selected Template", async (t) => {
  const { templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(templateRoot, descriptorValue([]));
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "other" }),
    /Доступны: test/,
  );
});

test("planner rejects protected Core targets before writing", async (t) => {
  const { templateRoot, targetRoot } = await temporaryRoots(t);
  await fs.writeFile(path.join(templateRoot, "payload.txt"), "payload\n", "utf8");

  for (const protectedTarget of [".openspec-store/payload.txt", ".GIT/config"]) {
    await writeDescriptor(
      templateRoot,
      descriptorValue([{ from: "payload.txt", to: protectedTarget }]),
    );
    await assert.rejects(
      buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
      /защищённый Core path/,
    );
  }
  assert.deepEqual(await fs.readdir(targetRoot), []);
});

test("planner rejects symlinks in Template and target", async (t) => {
  const { root, templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(
    templateRoot,
    descriptorValue([{ from: "payload", to: "output" }]),
  );
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "outside.txt"), "outside\n", "utf8");
  await fs.symlink(outside, path.join(templateRoot, "payload"), DIRECTORY_LINK_TYPE);
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /содержит symlink/,
  );

  await fs.rm(path.join(templateRoot, "payload"));
  await fs.mkdir(path.join(templateRoot, "payload"));
  await fs.writeFile(path.join(templateRoot, "payload", "payload.txt"), "payload\n", "utf8");
  await fs.symlink(outside, path.join(targetRoot, "output"), DIRECTORY_LINK_TYPE);
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /Target содержит symlink/,
  );
});

test("planner rejects an unreferenced Template symlink and an agent-path symlink", async (t) => {
  const { root, templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(templateRoot, descriptorValue([]));
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "outside.txt"), "outside\n", "utf8");
  const unusedLink = path.join(templateRoot, "unused-link");
  await fs.symlink(outside, unusedLink, DIRECTORY_LINK_TYPE);
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /Template root содержит symlink/,
  );

  await fs.rm(unusedLink);
  await fs.symlink(outside, path.join(targetRoot, ".agent"), DIRECTORY_LINK_TYPE);
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /Target содержит symlink/,
  );
});

test("planner rejects overlapping roots and file-directory collisions", async (t) => {
  const { root, templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(
    templateRoot,
    descriptorValue([
      { from: "file.txt", to: "collision" },
      { from: "directory", to: "collision" },
    ]),
  );
  await fs.writeFile(path.join(templateRoot, "file.txt"), "file\n", "utf8");
  await fs.mkdir(path.join(templateRoot, "directory"));
  await fs.writeFile(path.join(templateRoot, "directory", "nested.txt"), "nested\n", "utf8");
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /file-directory collision/,
  );

  const nestedTemplate = path.join(targetRoot, "template");
  await fs.mkdir(nestedTemplate);
  await writeDescriptor(nestedTemplate, descriptorValue([]));
  await assert.rejects(
    buildTemplatePlan({ templateRoot: nestedTemplate, targetRoot, agentId: "test" }),
    /не должны пересекаться/,
  );
  assert.equal((await fs.stat(root)).isDirectory(), true);
});

test("planner rejects a target parent file and accepts omitted optional assets", async (t) => {
  const { templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(
    templateRoot,
    descriptorValue([{ from: "instruction.md", to: "existing/instruction.md" }]),
  );
  await fs.writeFile(path.join(templateRoot, "instruction.md"), "Instructions.\n", "utf8");
  await fs.writeFile(path.join(targetRoot, "existing"), "file\n", "utf8");
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /file-directory collision/,
  );

  await fs.rm(path.join(targetRoot, "existing"));
  const result = await buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" });
  assert.deepEqual(result.agent.handoffs, {});
  assert.deepEqual(result.files.map(({ targetRelative }) => targetRelative), [
    "existing/instruction.md",
  ]);
});
