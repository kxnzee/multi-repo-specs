/** @fileoverview Контракт поставки Project Template для поддерживаемых агентов. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { ProjectTemplateService } from "@openspec-orch/core";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TEMPLATE_ROOT = path.join(ROOT, "templates/base");
const REQUIRED_SKILLS = [
  "base-intent",
  "openspec-base-apply-context",
  "openspec-base-graph-maintenance",
  "openspec-base-meta-planning",
  "openspec-base-test-cases",
];
const REQUIRED_SUBAGENTS = [
  "openspec-base-repository-evidence-scout.md",
];
const REMOVED_SUBAGENTS = [
  "openspec-base-planning-reviewer",
  "openspec-base-project-context-researcher",
];
const CURRENT_DOCS = [
  "docs/README.md",
  "docs/archive/README.md",
  "docs/archive/reference/OpenSpec для команды.md",
  "docs/technical/README.md",
  "docs/technical/development.md",
  "docs/technical/external-integrations.md",
  "docs/technical/product-contract.md",
  "docs/user/README.md",
  "docs/user/configuration.md",
  "docs/user/pilot-feedback.md",
  "docs/user/pilot-runbook.md",
  "docs/user/plugins.md",
  "docs/user/project-template.md",
  "docs/user/store-connection.md",
  "docs/user/supported-agents.md",
  "docs/user/team-flow.md",
];
const STRICT_AGENT_ARTIFACTS = [
  "plugins/codegraph/instructions.md",
  "templates/base/adapters/claude/subagents/openspec-base-repository-evidence-scout.md",
  "templates/base/commands/openspec-base-context.md",
  "templates/base/commands/openspec-base-intake.md",
  "templates/base/skills/openspec-base-apply-context/SKILL.md",
  "templates/base/skills/openspec-base-graph-maintenance/SKILL.md",
  "templates/base/skills/openspec-base-meta-planning/SKILL.md",
  "templates/base/skills/openspec-base-test-cases/SKILL.md",
  "templates/base/subagents/openspec-base-repository-evidence-scout.md",
];

const AGENTS = [
  {
    id: "claude",
    directory: ".claude",
    command: ".claude/commands/openspec-base-context.md",
    intakeCommand: ".claude/commands/openspec-base-intake.md",
    generatedOfficialRelative: "commands/opsx/opsx-explore.md",
    officialCommand: ".claude/commands/opsx/opsx-explore.md",
    instructions: "CLAUDE.md",
  },
  {
    id: "qwen",
    directory: ".qwen",
    command: ".qwen/commands/openspec-base-context.md",
    intakeCommand: ".qwen/commands/openspec-base-intake.md",
    generatedOfficialRelative: "commands/opsx-explore.md",
    officialCommand: ".qwen/commands/opsx-explore.md",
    instructions: "QWEN.md",
  },
  {
    id: "gigacode",
    directory: ".gigacode",
    command: ".gigacode/commands/openspec-base-context.md",
    intakeCommand: ".gigacode/commands/openspec-base-intake.md",
    generatedOfficialRelative: "commands/opsx-explore.md",
    officialCommand: ".gigacode/commands/opsx-explore.md",
    instructions: "GIGACODE.md",
  },
];

/** Удаляет provider frontmatter для сравнения канонического тела subagent. */
function stripFrontmatter(source) {
  if (!source.startsWith("---\n")) return source.trim();
  const end = source.indexOf("\n---\n", 4);
  return source.slice(end + 5).trim();
}

/** Возвращает repository-relative paths всех обычных файлов ниже directory. */
async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else if (entry.isFile()) files.push(path.relative(ROOT, absolute).split(path.sep).join("/"));
  }
  return files;
}

test("Project Template installs the same planning contract for every supported agent", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-template-contract-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  for (const agent of AGENTS) {
    const targetRoot = path.join(root, agent.id);
    await fs.mkdir(targetRoot, { recursive: true });

    const plan = await new ProjectTemplateService().plan({
      templateRoot: TEMPLATE_ROOT,
      targetRoot,
      agentId: agent.id,
    });
    await plan.assertAgentPackPathsAvailable();
    const generatedOfficialCommand = path.join(
      targetRoot,
      plan.agent.generatedDirectory,
      agent.generatedOfficialRelative,
    );
    await fs.mkdir(path.dirname(generatedOfficialCommand), { recursive: true });
    await fs.writeFile(generatedOfficialCommand, "official OpenSpec\n", "utf8");
    await plan.adaptGeneratedAgentPack();
    await plan.apply(await plan.inspectPreExistingFiles());

    assert.equal(
      await fs.readFile(path.join(targetRoot, agent.officialCommand), "utf8"),
      "official OpenSpec\n",
      `${agent.id}: official OpenSpec command must be preserved`,
    );
    await fs.access(path.join(targetRoot, agent.command));
    await fs.access(path.join(targetRoot, agent.intakeCommand));
    await fs.access(path.join(targetRoot, agent.instructions));
    await fs.access(path.join(targetRoot, "openspec/schemas/base-v1/schema.yaml"));
    await fs.access(path.join(targetRoot, "openspec/schemas/base-v1/templates/intake.md"));
    const startHere = await fs.readFile(
      path.join(targetRoot, "openspec/context/00-start-here.md"),
      "utf8",
    );
    for (const role of ["Владелец", "Аналитик", "Разработчик", "Тестировщик", "Лид"]) {
      assert.equal(startHere.includes(role), true, `${agent.id}: ${role}`);
    }
    const installedSkills = (await fs.readdir(
      path.join(targetRoot, agent.directory, "skills"),
    )).sort();
    assert.deepEqual(installedSkills, [...REQUIRED_SKILLS].sort(), `${agent.id}: skills`);
    const installedAgents = (await fs.readdir(
      path.join(targetRoot, agent.directory, "agents"),
    )).sort();
    assert.deepEqual(installedAgents, [...REQUIRED_SUBAGENTS].sort(), `${agent.id}: agents`);
    const installedAgentFiles = installedAgents.join("\n");
    for (const removed of REMOVED_SUBAGENTS) {
      assert.doesNotMatch(installedAgentFiles, new RegExp(removed, "u"));
    }

    const installedFiles = installedSkills.join("\n");
    assert.doesNotMatch(installedFiles, /openspec-base-context|sdd-|openlore/i);
    await assert.rejects(fs.access(path.join(targetRoot, "system-map.yaml")));
  }
});

test("base-v1 softly adds Intake before the preserved spec-driven workflow", async () => {
  const [configuration, schemaSource, intakeTemplate] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
    fs.readFile(path.join(TEMPLATE_ROOT, "openspec/schemas/base-v1/schema.yaml"), "utf8"),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "openspec/schemas/base-v1/templates/intake.md"),
      "utf8",
    ),
  ]);
  const schema = parse(schemaSource);

  assert.match(configuration, /^schema: base-v1$/mu);
  assert.deepEqual(
    schema.artifacts.map((artifact) => artifact.id),
    ["intake", "proposal", "specs", "design", "tasks"],
  );
  assert.deepEqual(schema.artifacts[0].requires, []);
  assert.equal(schema.artifacts[0].generates, "intake.md");
  assert.deepEqual(schema.artifacts[1].requires, ["intake"]);
  assert.deepEqual(schema.artifacts[2].requires, ["proposal"]);
  assert.deepEqual(schema.artifacts[3].requires, ["proposal"]);
  assert.deepEqual(schema.artifacts[4].requires, ["specs", "design"]);
  assert.deepEqual(schema.apply.requires, ["tasks"]);
  assert.equal(schema.apply.tracks, "tasks.md");
  assert.match(intakeTemplate, /^## 0\. Change Profile$/mu);
  assert.match(intakeTemplate, /^### 2\.5\. UI Section or Page$/mu);
  assert.match(intakeTemplate, /^## 4\. Access Rights$/mu);
  assert.match(intakeTemplate, /^## 5\. Interaction Diagram$/mu);
  assert.match(intakeTemplate, /PlantUML sequence diagram/u);
  assert.match(intakeTemplate, /^## 11\. Exploration$/mu);
  assert.match(intakeTemplate, /^## 12\. Planning Route$/mu);
  assert.doesNotMatch(intakeTemplate, /Owner Confirmation/u);
});

test("Claude adapter changes only subagent frontmatter", async () => {
  for (const name of REQUIRED_SUBAGENTS) {
    const [canonical, claude] = await Promise.all([
      fs.readFile(path.join(TEMPLATE_ROOT, "subagents", name), "utf8"),
      fs.readFile(path.join(TEMPLATE_ROOT, "adapters/claude/subagents", name), "utf8"),
    ]);
    assert.equal(stripFrontmatter(claude), stripFrontmatter(canonical), name);
  }
});

test("base Template exposes only the approved project skills, commands and subagent", async () => {
  assert.deepEqual(
    (await fs.readdir(path.join(TEMPLATE_ROOT, "skills"))).sort(),
    [...REQUIRED_SKILLS].sort(),
  );
  assert.deepEqual(
    (await fs.readdir(path.join(TEMPLATE_ROOT, "commands"))).sort(),
    ["openspec-base-context.md", "openspec-base-intake.md"],
  );
  assert.deepEqual(
    (await fs.readdir(path.join(TEMPLATE_ROOT, "subagents"))).sort(),
    [...REQUIRED_SUBAGENTS].sort(),
  );
  assert.deepEqual(
    (await fs.readdir(path.join(TEMPLATE_ROOT, "adapters/claude/subagents"))).sort(),
    [...REQUIRED_SUBAGENTS].sort(),
  );
});

test("intake command conducts and persists the base-v1 questionnaire", async () => {
  const command = await fs.readFile(
    path.join(TEMPLATE_ROOT, "commands/openspec-base-intake.md"),
    "utf8",
  );

  assert.match(command, /ровно один следующий вопрос/u);
  assert.match(command, /не обязан вручную переносить/u);
  assert.match(command, /openspec instructions intake --change <change-id> --json/u);
  assert.match(command, /сохрани все\s+подтверждённые ответы/u);
  assert.match(command, /new_integration/u);
  assert.match(command, /PlantUML sequence diagram/u);
  assert.match(command, /ready_for_proposal/u);
  assert.match(command, /explore_recommended/u);
  assert.match(command, /Не выполняй `next_action`/u);
  assert.doesNotMatch(command, /## Owner Confirmation/u);
});

test("context command supports scoped context and ADR promotion without automatic writes", async () => {
  const command = await fs.readFile(
    path.join(TEMPLATE_ROOT, "commands/openspec-base-context.md"),
    "utf8",
  );

  assert.match(command, /--change <change-id>/u);
  assert.match(command, /--spec <capability-path>/u);
  assert.match(command, /--domain <domain-path>/u);
  assert.match(command, /openspec list --specs --json/u);
  assert.match(command, /Master Spec может подтвердить/u);
  assert.match(command, /сама по себе не подтверждает ADR/u);
  assert.match(command, /трудно отменить/u);
  assert.match(command, /не блокирует завершённый Graph handoff/u);
  assert.match(command, /После отдельного подтверждения записать только показанный блок/u);
});

test("Store planning contract uses Code Repositories only as current-state evidence", async () => {
  const [configuration, instructions, metaPlanning, scout] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
    fs.readFile(path.join(TEMPLATE_ROOT, "agent-instructions.md"), "utf8"),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "skills/openspec-base-meta-planning/SKILL.md"),
      "utf8",
    ),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "subagents/openspec-base-repository-evidence-scout.md"),
      "utf8",
    ),
  ]);

  assert.match(configuration, /только для подтверждения или опровержения/u);
  assert.match(configuration, /не переносить в\s+центральный Store/u);
  assert.match(configuration, /внутренние файлы, классы, функции, модули/u);
  assert.match(instructions, /Code Repository ТОЛЬКО для подтверждения/u);
  assert.match(instructions, /ЗАПРЕЩЕНО переносить в Store/u);
  assert.match(metaPlanning, /finding с path:line остаётся в результате проверки/u);
  assert.match(scout, /ЗАПРЕЩЕНО переносить\s+их в артефакты центрального Store/u);
});

test("Repository impact contains only repositories with planned changes", async () => {
  const [configuration, instructions, metaPlanning, gates] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
    fs.readFile(path.join(TEMPLATE_ROOT, "agent-instructions.md"), "utf8"),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "skills/openspec-base-meta-planning/SKILL.md"),
      "utf8",
    ),
    fs.readFile(path.join(TEMPLATE_ROOT, "context/07-quality-gates.md"), "utf8"),
  ]);

  assert.match(configuration, /ЗАПРЕЩЕНО перечислять весь Repository registry/u);
  assert.match(configuration, /ЗАПРЕЩЕНО[^\n]+создавать строки no-change/u);
  assert.match(instructions, /Repository Impact — не инвентаризация registry/u);
  assert.match(metaPlanning, /review-only Repository не входит в Repository Impact/u);
  assert.doesNotMatch(gates, /релевантный `no-change` обоснован/u);
});

test("critical Store guardrails use explicit fail-closed directives", async () => {
  const [configuration, instructions, metaPlanning, scout] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_ROOT, "openspec/config.yaml"), "utf8"),
    fs.readFile(path.join(TEMPLATE_ROOT, "agent-instructions.md"), "utf8"),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "skills/openspec-base-meta-planning/SKILL.md"),
      "utf8",
    ),
    fs.readFile(
      path.join(TEMPLATE_ROOT, "subagents/openspec-base-repository-evidence-scout.md"),
      "utf8",
    ),
  ]);

  assert.match(configuration, /ЖЁСТКИЙ ЗАПРЕТ/u);
  assert.match(instructions, /КРИТИЧЕСКИЕ ЗАПРЕТЫ/u);
  assert.match(instructions, /НЕМЕДЛЕННО ОСТАНОВИСЬ/u);
  assert.match(metaPlanning, /ОБЯЗАН вернуть BLOCKER/u);
  assert.match(scout, /ЗАПРЕЩЕНО переносить/u);
});

test("every executable agent artifact except base-intent declares fail-closed directives", async () => {
  for (const artifact of STRICT_AGENT_ARTIFACTS) {
    const source = await fs.readFile(path.join(ROOT, artifact), "utf8");
    assert.match(source, /ОБЯЗАН|ЗАПРЕЩЕНО/u, artifact);
    assert.match(source, /BLOCKER/u, artifact);
  }
});

test("Project Template contains no references to removed orchestration layers", async () => {
  const files = (await listFiles(TEMPLATE_ROOT)).filter((file) => (
    file.endsWith(".md") || file.endsWith(".yaml")
  ));
  const source = (await Promise.all(files.map((file) => (
    fs.readFile(path.join(ROOT, file), "utf8")
  )))).join("\n");
  for (const removed of REMOVED_SUBAGENTS) {
    assert.doesNotMatch(source, new RegExp(removed, "u"));
  }
});

test("docs inventory contains only current guidance and the protected historical reference", async () => {
  assert.deepEqual((await listFiles(path.join(ROOT, "docs"))).sort(), [...CURRENT_DOCS].sort());
});

test("current Markdown guidance has no broken local links", async () => {
  const sources = [
    "README.md",
    "BACKLOG.md",
    ...CURRENT_DOCS.filter((file) => !file.includes("docs/archive/reference/")),
  ];
  for (const sourcePath of sources) {
    const source = await fs.readFile(path.join(ROOT, sourcePath), "utf8");
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      let target = match[1].trim();
      if (target.startsWith("<")) target = target.slice(1, target.indexOf(">"));
      else target = target.split(/\s+/u)[0];
      if (/^(?:[a-z]+:|#)/iu.test(target)) continue;
      const pathPart = target.split("#", 1)[0];
      if (!pathPart) continue;
      const resolved = path.resolve(path.dirname(path.join(ROOT, sourcePath)), pathPart);
      await assert.doesNotReject(
        fs.access(resolved),
        `${sourcePath}: missing local link ${target}`,
      );
    }
  }
});

test("README documents the public JSON status option", async () => {
  const readme = await fs.readFile(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /openspec-orch status <change-id> \[--json\]/);
});

test("current user documentation exposes the intake and scoped context commands", async () => {
  const [readme, supportedAgents, projectTemplate, teamFlow, pilotRunbook] = await Promise.all([
    fs.readFile(path.join(ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs/user/supported-agents.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs/user/project-template.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs/user/team-flow.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs/user/pilot-runbook.md"), "utf8"),
  ]);

  for (const source of [readme, supportedAgents, projectTemplate, teamFlow, pilotRunbook]) {
    assert.match(source, /\/openspec-base-intake/u);
  }
  for (const source of [readme, projectTemplate, teamFlow, pilotRunbook]) {
    assert.match(source, /\/openspec-base-context audit --change <change-id>/u);
  }
  assert.match(supportedAgents, /две project commands/u);
  assert.doesNotMatch(readme, /тремя ограниченными\s+read-only subagents/u);
  assert.doesNotMatch(readme, /context researcher/u);
  assert.doesNotMatch(supportedAgents, /единственная project command/u);
});
