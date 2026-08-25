/** @fileoverview Real Commander integration for Change Tracking command contributions. */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { PluginCommandRegistry } from "@openspec-orch/core";
import { registerChangeTrackingCommands } from "../plugins/change-tracking/lib/commands.js";
import { assignmentContext } from "../plugins/change-tracking/test/assignment-context.js";

test("Change Tracking executes the preserved root CLI grammar through public command API", async () => {
  const outputs = [];
  const resolutions = [];
  const context = assignmentContext({
    invocation: Object.freeze({
      id: "frontend",
      role: "code",
      path: "/workspace/repositories/frontend",
    }),
  });

  /** Builds one fresh Commander program while preserving observed service state. */
  function program() {
    const root = new Command().exitOverride();
    const commands = new PluginCommandRegistry({
      allowedCommands: new Set(["assign", "status", "record", "verify"]),
      parent: root,
      path: [],
      pluginId: "change-tracking",
      resolveContext: async (pluginId, scope, requireBinding) => {
        resolutions.push([pluginId, scope, requireBinding]);
        return context;
      },
    });
    registerChangeTrackingCommands(commands, {
      output: { log: (message) => outputs.push(message) },
      prompt: async () => true,
    });
    return root;
  }

  await program().parseAsync([
    "node", "openspec-orch", "assign", "checkout-flow", "--repo", "frontend",
  ]);
  await program().parseAsync([
    "node", "openspec-orch", "status", "checkout-flow", "--json",
  ]);
  await program().parseAsync([
    "node", "openspec-orch", "record", "assignment", "checkout-flow",
    "--repo", "frontend", "--commit", "b".repeat(40), "--status", "completed",
    "--source", "agent",
  ]);
  await program().parseAsync(["node", "openspec-orch", "verify", "checkout-flow"]);
  await program().parseAsync([
    "node", "openspec-orch", "record", "verification", "checkout-flow",
    "--result", "pass", "--source", "human",
  ]);
  await program().parseAsync([
    "node", "openspec-orch", "status", "checkout-flow", "--json",
  ]);
  await program().parseAsync([
    "node", "openspec-orch", "status", "checkout-flow",
  ]);

  assert.equal(resolutions.every(([pluginId, scope]) => (
    pluginId === "change-tracking" && scope === "store"
  )), true);
  assert.deepEqual(
    resolutions.map(([, , requireBinding]) => requireBinding),
    [true, false, true, true, true, false, false],
  );
  const statuses = outputs.filter((value) => value.startsWith("{"))
    .map((value) => JSON.parse(value));
  const status = statuses.at(-1);
  assert.deepEqual(status.current_repository, {
    repository_id: "frontend",
    role: "code",
    path: "/workspace/repositories/frontend",
    in_cycle: true,
  });
  assert.equal(status.results[0].status, "completed");
  assert.equal(status.verification.result, "pass");
  assert.equal(outputs.includes("✓ Change checkout-flow — готов"), true);
  assert.equal(outputs.some((value) => value.includes("✓ frontend — завершён")), true);
  assert.equal(outputs.some((value) => value.includes("✓ Проверка: пройдена")), true);
  assert.equal(outputs.includes("  → Далее: готово"), true);
});
