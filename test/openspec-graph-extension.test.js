/** @fileoverview Plugin-owned Graph guidance reaches every supported Agent adapter. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { BundledAgentPackage, BundledAgentProvider } from "@openspec-orch/core";
import plugin from "../plugins/openspec-graph/index.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("Graph Plugin delivers the same impact verification instructions to all Agent adapters", async () => {
  const repository = Object.freeze({ id: "management", role: "store" });
  const [contribution] = plugin.extensions({ repository });
  assert.deepEqual(contribution.target, repository);
  const payload = { ...contribution, root: path.resolve(ROOT, "plugins/openspec-graph", contribution.root) };
  const packages = await Promise.all(["claude", "qwen", "gigacode"].map((id) => (
    BundledAgentPackage.load(path.join(ROOT, "agents", id))
  )));
  const adapter = new BundledAgentProvider(packages).adapter;
  await adapter.validateExtension(payload, { ownerId: plugin.id });
  const canonical = await fs.readFile(path.join(payload.root, "agent-instructions.md"), "utf8");
  for (const id of ["qwen", "gigacode"]) {
    const manifest = JSON.parse(await fs.readFile(path.join(payload.root, `${id}-extension.json`), "utf8"));
    assert.equal(await fs.readFile(path.join(payload.root, manifest.contextFileName), "utf8"), canonical);
  }
  const hooks = JSON.parse(await fs.readFile(path.join(payload.root, "hooks/hooks.json"), "utf8"));
  const command = hooks.hooks.SessionStart[0].hooks[0].command;
  assert.equal(command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js"');
  const { stdout } = await execa(process.execPath, [path.join(payload.root, "hooks/session-start.js")]);
  assert.equal(stdout.trim(), canonical.trim());
  assert.match(canonical, /обязательно проверь Repository Impact через\s+`get_spec_change_impact`/u);
  assert.match(canonical, /openspec-orch plugin exec --repo <store-id> openspec-graph inspect --json/u);
});
