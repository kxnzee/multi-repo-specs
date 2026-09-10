/** @fileoverview Validate every shipped native payload without installing a provider. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { BundledAgentPackage } from "@openspec-orch/core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Enumerates standalone and Plugin-owned Extension payloads. */
async function payloads() {
  const result = [];
  for (const parent of ["extensions", "plugins"]) {
    for (const entry of await fs.readdir(path.join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = path.join(ROOT, parent, entry.name, ...(parent === "plugins" ? ["extension"] : []));
      if (await fs.stat(path.join(root, "gigacode-extension.json")).catch(() => null)) result.push(root);
    }
  }
  return result;
}

test("every shipped Qwen and GigaCode payload resolves its actual marketplace selector", async () => {
  const roots = await payloads();
  assert.ok(roots.length > 0, "shipped payloads must be discovered");
  for (const agentId of ["qwen", "gigacode"]) {
    const { adapter, definition } = await BundledAgentPackage.load(path.join(ROOT, "agents", agentId));
    for (const root of roots) {
      const manifest = JSON.parse(await fs.readFile(path.join(root, definition.manifest), "utf8"));
      await adapter.validateExtension({ id: manifest.name, root }, definition);
      assert.ok((await fs.readFile(path.join(root, manifest.contextFileName), "utf8")).trim(), root);
    }
  }
});

test("native scout discovery uses agents directory and preserves canonical plan metadata", async () => {
  const root = path.join(ROOT, "extensions/spec-driven-extended");
  const name = "spec-driven-extended-repository-evidence-scout.md";
  const canonical = await fs.readFile(path.join(root, "subagents", name), "utf8");
  // Qwen loads agents/*.md independently of native manifest fields.
  const source = await fs.readFile(path.join(root, "agents", name), "utf8");
  assert.equal(source, canonical);
  const metadata = parse(source.split("---\n")[1]);
  assert.equal(metadata.approvalMode, "plan");
  assert.equal(metadata.model, "inherit");
});
