/** @fileoverview Контракт и security-проверки общего Project Template engine. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import {
  BASE_TEMPLATE_ROOT,
  buildTemplatePlan,
  parseTemplateDescriptor,
} from "../src/internal/template/index.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

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
        openspec_adapter: "qwen",
        generated_directory: ".qwen",
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

  const builtIn = await buildTemplatePlan({
    templateRoot: BASE_TEMPLATE_ROOT,
    targetRoot,
    agentId: "qwen",
  });
  assert.deepEqual(builtIn.supportedAgentIds, ["gigacode", "qwen"]);
  assert.equal(
    builtIn.files.some(({ targetRelative }) => targetRelative === ".qwen/commands/sdd-context.md"),
    true,
  );
  assert.equal(
    builtIn.files.some(({ targetRelative }) => targetRelative === ".sdd/instructions/explore.md"),
    true,
  );
  assert.equal(
    builtIn.files.some(({ targetRelative }) => targetRelative === "openspec-orch.yaml"),
    false,
  );
  assert.deepEqual(await fs.readdir(targetRoot), []);
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
    0o755,
  );
});

test("descriptor rejects missing fields and unsafe portable paths", () => {
  assert.throws(() => parseTemplateDescriptor("agents: {}\n"), /непустой agents/);
  assert.throws(() => parseTemplateDescriptor("agents:\n  Test: {}\n"), /lowercase kebab-case/);

  for (const unsafePath of ["../outside", "/absolute", "nested//file", "./file", "C:\\temp"] ) {
    const value = descriptorValue([{ from: unsafePath, to: "." }]);
    assert.throws(() => parseTemplateDescriptor(stringify(value)), /относительным POSIX-путём/);
  }

  const nestedRoots = descriptorValue([]);
  nestedRoots.agents.test.target_directory = ".qwen/nested";
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
  await fs.writeFile(path.join(root, "outside.txt"), "outside\n", "utf8");
  await fs.symlink(path.join(root, "outside.txt"), path.join(templateRoot, "payload"));
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /содержит symlink/,
  );

  await fs.rm(path.join(templateRoot, "payload"));
  await fs.writeFile(path.join(templateRoot, "payload"), "payload\n", "utf8");
  await fs.symlink(path.join(root, "outside.txt"), path.join(targetRoot, "output"));
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /Target содержит symlink/,
  );
});

test("planner rejects an unreferenced Template symlink and an agent-path symlink", async (t) => {
  const { root, templateRoot, targetRoot } = await temporaryRoots(t);
  await writeDescriptor(templateRoot, descriptorValue([]));
  await fs.writeFile(path.join(root, "outside.txt"), "outside\n", "utf8");
  const unusedLink = path.join(templateRoot, "unused-link");
  await fs.symlink(path.join(root, "outside.txt"), unusedLink);
  await assert.rejects(
    buildTemplatePlan({ templateRoot, targetRoot, agentId: "test" }),
    /Template root содержит symlink/,
  );

  await fs.rm(unusedLink);
  await fs.symlink(path.join(root, "outside.txt"), path.join(targetRoot, ".agent"));
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
