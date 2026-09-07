/** @fileoverview Store instruction delivery preserves user files and Agent pack boundaries. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BundledAgentPackage, ProjectTemplateService } from "@openspec-orch/core";
import { stringify } from "yaml";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Builds independent Template and Store directories with the selected Agent. */
async function fixture(t, id = "qwen") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "store-instructions-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const templateRoot = path.join(temporary, "template");
  const targetRoot = path.join(temporary, "store");
  await fs.mkdir(templateRoot);
  await fs.mkdir(targetRoot);
  await fs.writeFile(path.join(templateRoot, "STORE.md"), "Store context\n");
  await fs.writeFile(path.join(templateRoot, "entry.md"), "Read STORE.md\n");
  const descriptor = {
    id: "fixture", name: "Fixture", agentInstructions: "entry.md",
    copy: [{ from: "STORE.md", to: "STORE.md" }],
  };
  const { definition: agent } = await BundledAgentPackage.load(path.join(ROOT, "agents", id));
  const service = new ProjectTemplateService();
  return {
    targetRoot, templateRoot, agent, descriptor,
    async plan() {
      await fs.writeFile(path.join(templateRoot, "template.yaml"), stringify(descriptor));
      return service.plan({ templateRoot, targetRoot, agent });
    },
  };
}

test("Store entrypoint preserves existing identical files and rejects conflicting user instructions", async (t) => {
  for (const id of ["claude", "qwen", "gigacode"]) {
    const f = await fixture(t, id);
    const entry = path.join(f.targetRoot, f.agent.instructionsFile);
    await fs.writeFile(entry, "My project rules\n");
    const plan = await f.plan();
    await assert.rejects(plan.install(), /существующий файл с другим содержимым/u);
    assert.equal(await fs.readFile(entry, "utf8"), "My project rules\n");
    await assert.rejects(fs.access(path.join(f.targetRoot, "STORE.md")), { code: "ENOENT" });
    await fs.writeFile(entry, "Read STORE.md\n");
    assert.deepEqual(await (await f.plan()).install(), { created: ["STORE.md"], updated: [] });
  }
});

test("an instruction file created after preflight is never overwritten", async (t) => {
  const f = await fixture(t);
  const plan = await f.plan();
  const unchanged = await plan.inspectPreExistingFiles();
  const entry = path.join(f.targetRoot, f.agent.instructionsFile);
  await fs.writeFile(entry, "Created concurrently\n");
  await assert.rejects(plan.apply(unchanged), { code: "EEXIST" });
  assert.equal(await fs.readFile(entry, "utf8"), "Created concurrently\n");
});

test("agentInstructions is optional and cannot authorize arbitrary protected copies", async (t) => {
  const f = await fixture(t);
  delete f.descriptor.agentInstructions;
  assert.deepEqual((await f.plan()).targetPaths, ["STORE.md"]);
  f.descriptor.copy.push({ from: "entry.md", to: f.agent.instructionsFile });
  await assert.rejects(f.plan(), /защищённый Agent path/u);
  f.descriptor.copy.pop();
  f.descriptor.agentInstructions = "../outside.md";
  await assert.rejects(f.plan(), /Некорректный/u);
  f.descriptor.agentInstructions = ".";
  await assert.rejects(f.plan(), /Некорректный/u);
  await fs.mkdir(path.join(f.templateRoot, "directory"));
  f.descriptor.agentInstructions = "directory";
  await assert.rejects(f.plan(), /обычный файл/u);
  f.descriptor.agentInstructions = "entry.md";
  f.descriptor.copy.push({ from: "entry.md", to: ".qwen/commands/opsx-apply.md" });
  await assert.rejects(f.plan(), /защищённый Agent path/u);
});
