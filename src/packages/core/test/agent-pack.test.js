/** @fileoverview Safe, repeatable OpenSpec payload delivery to connected repositories. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentPackPlan, AgentPackService } from "../internal/agents/agent-pack.js";

/** Create an isolated checkout and remove it after the test. */
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "orch-agent-pack-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("pack installs missing files, preserves unrelated files and repeats without changes", async (t) => {
  const root = await fixture(t);
  const plan = new AgentPackPlan([{ relative: ".agent/skills/openspec-apply/SKILL.md", contents: "upstream" }]);
  await fs.writeFile(path.join(root, "README.md"), "user");
  await plan.install(root);
  await plan.install(root);
  assert.equal(await fs.readFile(path.join(root, plan.files[0].relative), "utf8"), "upstream");
  assert.equal(await fs.readFile(path.join(root, "README.md"), "utf8"), "user");
});

test("pack reports every managed difference without changing local files", async (t) => {
  const root = await fixture(t);
  const currentSkill = ".agent/skills/openspec-apply/SKILL.md";
  const currentCommand = ".agent/commands/opsx-apply.md";
  const retiredSkill = ".agent/skills/openspec-base-apply-context/SKILL.md";
  const retiredCommand = ".agent/commands/opsx-old.md";
  const unrelatedSkill = ".agent/skills/team-review/SKILL.md";
  const unrelatedCommand = ".agent/commands/team-review.md";
  for (const [relative, contents] of [
    [currentCommand, "local"], [retiredSkill, "retired skill"], [retiredCommand, "retired command"],
    [unrelatedSkill, "user skill"], [unrelatedCommand, "user command"],
  ]) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), contents);
  }
  const plan = new AgentPackPlan(
    [
      { relative: currentSkill, contents: "current skill" },
      { relative: currentCommand, contents: "current command" },
    ],
    { managedEntries: [
      { directory: ".agent/skills", kind: "directory", prefix: "openspec-", suffix: "" },
      { directory: ".agent/commands", kind: "file", prefix: "opsx-", suffix: ".md" },
    ] },
  );

  assert.deepEqual(await plan.inspect(root), {
    missing: [currentSkill],
    changed: [currentCommand],
    retired: [retiredCommand, path.dirname(retiredSkill)].sort(),
  });
  assert.equal(await fs.readFile(path.join(root, currentCommand), "utf8"), "local");
  assert.equal(await fs.readFile(path.join(root, retiredSkill), "utf8"), "retired skill");
  assert.equal(await fs.readFile(path.join(root, retiredCommand), "utf8"), "retired command");
  assert.equal(await fs.readFile(path.join(root, unrelatedSkill), "utf8"), "user skill");
  assert.equal(await fs.readFile(path.join(root, unrelatedCommand), "utf8"), "user command");
});

test("pack detects all conflicts before writing any missing file", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "existing.md"), "custom");
  const plan = new AgentPackPlan([
    { relative: "new.md", contents: "new" }, { relative: "existing.md", contents: "upstream" },
  ]);
  await assert.rejects(plan.install(root), /AGENT_PACK_CONFLICT/);
  await assert.rejects(fs.stat(path.join(root, "new.md")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(root, "existing.md"), "utf8"), "custom");
});

test("pack rejects a symlinked parent and traversal without writing outside the checkout", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.symlink(outside, path.join(root, "linked"), "junction");
  for (const relative of ["linked/file.md", "../escape.md"]) {
    await assert.rejects(new AgentPackPlan([{ relative, contents: "bad" }]).install(root), /AGENT_PACK_UNSAFE/);
  }
  assert.deepEqual(await fs.readdir(outside), []);
});

test("pack selects upstream commands and skills without copying local settings or custom commands", async (t) => {
  const root = await fixture(t);
  const entries = {
    ".agent/skills/openspec-apply/SKILL.md": "apply",
    ".agent/commands/opsx-apply.md": "command",
    ".agent/commands/custom.md": "custom",
    ".agent/settings.json": "private",
  };
  for (const [relative, contents] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), contents);
  }
  const service = new AgentPackService({ resolve: () => ({ targetDirectory: ".agent", commandsDirectory: ".agent/commands" }) });
  const plan = await service.plan({ root, project: { agent: { id: "test" } } });
  assert.deepEqual(plan.files.map(({ relative }) => relative).sort(), [
    ".agent/commands/opsx-apply.md", ".agent/skills/openspec-apply/SKILL.md",
  ]);
});
