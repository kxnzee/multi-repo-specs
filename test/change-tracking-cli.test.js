/** @fileoverview Real Commander integration for Change Tracking command contributions. */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { PluginCommandRegistry } from "@openspec-orch/core";
import { registerChangeTrackingCommands } from "../plugins/change-tracking/lib/commands.js";

test("Change Tracking executes the preserved root CLI grammar through public command API", async () => {
  const calls = [];
  const outputs = [];
  const resolutions = [];
  const context = Object.freeze({
    invocation: Object.freeze({
      id: "frontend",
      role: "code",
      path: "/workspace/repositories/frontend",
    }),
  });
  const service = {
    async assign(input) {
      calls.push(["assign", input.changeId, input.repositoryIds]);
      await input.confirm({
        changeId: input.changeId,
        planningRevision: "a".repeat(40),
        repositories: input.repositoryIds,
        path: ".openspec-orch/changes/test.json",
        kind: "create",
      });
      return {
        status: "created",
        cycle: { cycleId: "cycle-test" },
        path: ".openspec-orch/changes/test.json",
      };
    },
    async status(changeId) {
      calls.push(["status", changeId]);
      return {
        changeId,
        cycle: {
          cycleId: "cycle-test",
          planningRevision: "a".repeat(40),
          repositories: ["frontend"],
        },
        committed: true,
        repositories: [{
          repositoryId: "frontend",
          state: "completed",
          receipt: {
            implementation_revision: "b".repeat(40),
            source: "agent",
          },
          commitAvailable: true,
          head: "b".repeat(40),
          headMatches: true,
        }],
        snapshot: null,
        verification: null,
        nextAction: "вызвать verify",
      };
    },
    async recordAssignment(input) {
      calls.push([
        "record-assignment",
        input.changeId,
        input.repositoryId,
        input.implementationRevision,
        input.status,
        input.source,
      ]);
      const receipt = {
        receipt_id: "result-test",
        repository_id: input.repositoryId,
        implementation_revision: input.implementationRevision,
        status: input.status,
        source: input.source,
      };
      await input.confirm({ receipt, existing: null, head: input.implementationRevision });
      return { status: "created", receipt };
    },
    async verify(changeId) {
      calls.push(["verify", changeId]);
      return {
        snapshot: {
          snapshot_id: "snap-test",
          implementations: { frontend: "b".repeat(40) },
        },
      };
    },
    async recordVerification(input) {
      calls.push(["record-verification", input.changeId, input.result, input.source]);
      const receipt = {
        receipt_id: "verification-test",
        snapshot_id: "snap-test",
        result: input.result,
        source: input.source,
      };
      await input.confirm({ receipt, existing: null, snapshot: {} });
      return { status: "created", receipt };
    },
  };

  /** Builds one fresh Commander program while preserving observed service state. */
  function program() {
    const root = new Command().exitOverride();
    const commands = new PluginCommandRegistry({
      allowedCommands: new Set(["assign", "status", "record", "verify"]),
      parent: root,
      path: [],
      pluginId: "change-tracking",
      resolveContext: async (pluginId, scope) => {
        resolutions.push([pluginId, scope]);
        return context;
      },
    });
    registerChangeTrackingCommands(commands, {
      output: { log: (message) => outputs.push(message) },
      prompt: async () => true,
      serviceFactory: () => service,
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

  assert.deepEqual(calls.map(([name]) => name), [
    "assign",
    "status",
    "record-assignment",
    "verify",
    "record-verification",
  ]);
  assert.equal(resolutions.every(([pluginId, scope]) => (
    pluginId === "change-tracking" && scope === "store"
  )), true);
  const status = JSON.parse(outputs.find((value) => value.startsWith("{")));
  assert.deepEqual(status.current_repository, {
    repository_id: "frontend",
    role: "code",
    path: "/workspace/repositories/frontend",
    in_cycle: true,
  });
});
