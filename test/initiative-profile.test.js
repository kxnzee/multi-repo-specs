/** @fileoverview Real OpenSpec lifecycle and local customization of the initiative profile. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { parse, stringify } from "yaml";
import { BundledAgentPackage, ProjectTemplateService, createRepository, createRepositoryCheckout, openspec as openSpecService } from "@openspec-orch/core";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("initiative supports proposal/specs/verify and preserves Store-owned customization", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "initiative-profile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templateRoot = path.join(ROOT, "templates/initiative");
  const { definition: agent } = await BundledAgentPackage.load(path.join(ROOT, "agents/qwen"));
  const service = new ProjectTemplateService();
  const plan = await service.plan({ templateRoot, targetRoot: root, agent });
  await plan.install();
  const facade = openSpecService.forRepository(createRepositoryCheckout(createRepository({
    id: "management", role: "store", remote: "https://example.test/management.git", defaultBranch: "main",
  }), root));
  /** Runs the checkout-local OpenSpec binary supplied by the test environment. */
  const openspec = async (...args) => execa("openspec", args, { cwd: root });
  await openspec("schema", "validate", "initiative", "--json");
  await openspec("new", "change", "shared-outcome", "--schema", "initiative");
  const status = async () => JSON.parse((await openspec("status", "--change", "shared-outcome", "--json")).stdout);
  let result = await status();
  assert.deepEqual(result.artifacts.map(({ id, status }) => [id, status]), [
    ["proposal", "ready"], ["specs", "blocked"], ["verify", "blocked"],
  ]);
  const change = path.join(root, "openspec/changes/shared-outcome");
  await fs.writeFile(path.join(change, "proposal.md"), "# Shared outcome\n\n## Why\nTwo teams need consistent customer outcomes.\n\n## What Changes\n- Introduce a shared result.\n\n## Capabilities\n\n### New Capabilities\n- `shared`: common result.\n\n### Modified Capabilities\n\n## Impact\nTwo participating teams.\n\n## Repository Impact\n\n| Repository | Capabilities |\n| --- | --- |\n| `payments` | `shared` |\n| `platform` | `shared` |\n");
  await fs.mkdir(path.join(change, "specs/shared"), { recursive: true });
  await fs.writeFile(path.join(change, "specs/shared/spec.md"), "## ADDED Requirements\n\n### Requirement: Shared result\nThe system SHALL return a traceable confirmation for an authorized customer request.\n\n#### Scenario: Authorized request\n- **WHEN** the customer submits an authorized request\n- **THEN** the system returns a confirmation identifier\n");
  result = await status();
  assert.equal(result.artifacts.find(({ id }) => id === "verify").status, "ready");
  assert.equal((await facade.nextAction("shared-outcome")).artifact, "verify");
  const instruction = JSON.parse((await openspec("instructions", "verify", "--change", "shared-outcome", "--json")).stdout);
  assert.equal(instruction.outputPath, "verify.md");
  await fs.writeFile(path.join(change, "verify.md"), "# Verification\n\nPlanning reviewed. Delivery is unverified: no team evidence supplied.\n");
  assert.equal((await status()).isComplete, true);
  await openspec("validate", "shared-outcome", "--strict", "--no-interactive");
  const apply = JSON.parse((await openspec("instructions", "apply", "--change", "shared-outcome", "--json")).stdout);
  assert.match(apply.instruction, /no code Apply/);
  assert.equal((await facade.nextAction("shared-outcome")).action, "consult_change_context");
  await assert.rejects(fs.access(path.join(change, "tasks.md")), { code: "ENOENT" });

  // Local rules and an added artifact must be consumed by OpenSpec, not ignored.
  await fs.writeFile(path.join(root, "openspec/config.yaml"), stringify({ schema: "initiative",
    context: "Customer organization: Example", rules: { proposal: ["Include the regional impact."] } }));
  const schemaPath = path.join(root, "openspec/schemas/initiative/schema.yaml");
  const schema = parse(await fs.readFile(schemaPath, "utf8"));
  schema.artifacts.push({ id: "risk-review", generates: "risks.md", description: "Local risk assessment",
    template: "risks.md", requires: ["specs"], instruction: "Assess organizational risks." });
  schema.artifacts.find(({ id }) => id === "verify").requires = ["risk-review"];
  await fs.writeFile(schemaPath, stringify(schema));
  await fs.writeFile(path.join(root, "openspec/schemas/initiative/templates/risks.md"), "# Organizational risks\n");
  await openspec("schema", "validate", "initiative", "--json");
  await fs.rm(path.join(change, "verify.md"));
  result = await status();
  assert.equal(result.artifacts.find(({ id }) => id === "risk-review").status, "ready");
  assert.equal(result.artifacts.find(({ id }) => id === "verify").status, "blocked");
  const proposal = JSON.parse((await openspec("instructions", "proposal", "--change", "shared-outcome", "--json")).stdout);
  assert.match(JSON.stringify(proposal), /regional impact/);
  const customized = await fs.readFile(schemaPath, "utf8");
  await assert.rejects((await service.plan({ templateRoot, targetRoot: root, agent })).install());
  assert.equal(await fs.readFile(schemaPath, "utf8"), customized);
});
