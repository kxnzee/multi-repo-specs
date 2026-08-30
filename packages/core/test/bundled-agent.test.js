/** @fileoverview Контракт distribution-owned Agent definitions. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BundledAgentPackage, BundledAgentProvider } from "@openspec-orch/core";

import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Создаёт минимальный Agent descriptor fixture. */
async function agentFixture(t, id = "qwen") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-bundled-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "adapter.js"), `export default {
  adaptOpenSpecPack() {},
  preflight() {},
  validateExtension() {},
  invokeExtension() {},
};
`);
  await fs.writeFile(path.join(root, "agent.yaml"), [
    `id: ${id}`,
    "name: Qwen Code",
    "openspec:",
    "  adapter: qwen",
    "  generatedDirectory: .qwen",
    "  targetDirectory: .qwen",
    "  commandsDirectory: .qwen/commands",
    "  instructionsFile: QWEN.md",
    "native:",
    "  adapter: adapter.js",
    "  executable: qwen",
    "  scope: project",
    "  manifest: qwen-extension.json",
    "",
  ].join("\n"));
  return root;
}

test("BundledAgentProvider resolves immutable Agent independently from Template", async (t) => {
  const root = await agentFixture(t);
  const agentPackage = await BundledAgentPackage.load(root);
  const provider = new BundledAgentProvider([agentPackage]);

  assert.deepEqual(provider.catalog.entries.map(({ id, name }) => ({ id, name })), [
    { id: "qwen", name: "Qwen Code" },
  ]);
  assert.equal(provider.resolve("qwen"), agentPackage.definition);
  assert.equal(provider.resolve("qwen").openSpecId, "qwen");
  assert.equal(typeof provider.adapter.invokeExtension, "function");
  assert.equal(Object.isFrozen(provider.resolve("qwen")), true);
  assert.throws(() => provider.resolve("claude"), /AGENT_NOT_DISCOVERED/);
});

test("BundledAgentPackage rejects extra fields, identity mismatch and symlink root", async (t) => {
  const extended = await agentFixture(t, "extended");
  await fs.appendFile(path.join(extended, "agent.yaml"), "version: 1\n");
  await assert.rejects(BundledAgentPackage.load(extended), /BUNDLED_AGENT_INVALID/);

  const mismatched = await agentFixture(t, "other");
  await assert.rejects(
    BundledAgentPackage.load(mismatched, { expectedId: "qwen" }),
    /identity/,
  );

  const target = await agentFixture(t, "target");
  const link = path.join(path.dirname(target), `agent-link-${path.basename(target)}`);
  t.after(() => fs.rm(link, { force: true }));
  await createDirectoryLink(target, link);
  await assert.rejects(BundledAgentPackage.load(link), /symlink/);

  const nested = await agentFixture(t, "nested");
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-agent-adapter-"));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.writeFile(path.join(external, "adapter.js"), "export default {};\n");
  await fs.rm(path.join(nested, "adapter.js"));
  await createDirectoryLink(external, path.join(nested, "runtime"));
  const descriptor = await fs.readFile(path.join(nested, "agent.yaml"), "utf8");
  await fs.writeFile(
    path.join(nested, "agent.yaml"),
    descriptor.replace("adapter: adapter.js", "adapter: runtime/adapter.js"),
  );
  await assert.rejects(BundledAgentPackage.load(nested), /native\.adapter.*symlink/);
});
