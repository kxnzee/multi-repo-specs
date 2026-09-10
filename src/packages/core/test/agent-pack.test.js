/** @fileoverview Safe, repeatable OpenSpec payload delivery to connected repositories. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentPackPlan, AgentPackService } from "../internal/agent-pack.js";

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
