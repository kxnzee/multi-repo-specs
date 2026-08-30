/** @fileoverview Shared OpenSpec application recommendations used by protocol adapters. */

import assert from "node:assert/strict";
import test from "node:test";

import { RepositoryOpenSpec } from "@openspec-orch/core";

/** Creates a scoped facade that returns one canonical status fixture. */
function repositoryOpenSpec(status) {
  return new RepositoryOpenSpec(
    { root: "/store" },
    {
      cwd: "/store",
      run: async (_executable, args) => {
        assert.deepEqual(args, ["status", "--change", "pay", "--json"]);
        return JSON.stringify(status);
      },
    },
  );
}

test("OpenSpec application derives a ready artifact without MCP-owned workflow policy", async () => {
  const application = repositoryOpenSpec({
    changeName: "pay",
    artifacts: [
      { id: "proposal", status: "done", requires: [] },
      { id: "design", status: "ready", requires: ["proposal"] },
    ],
    applyRequires: ["design"],
  });

  assert.deepEqual(await application.nextAction("pay"), {
    action: "prepare_artifact",
    actor: "agent",
    reason: "OpenSpec разблокировал следующий artifact",
    change_id: "pay",
    artifact: "design",
  });
});

test("OpenSpec application leaves ambiguous and blocked transitions to a human", async () => {
  const ambiguous = repositoryOpenSpec({
    artifacts: [
      { id: "design", status: "ready" },
      { id: "specs", status: "ready" },
    ],
  });
  const blocked = repositoryOpenSpec({
    artifacts: [{ id: "tasks", status: "blocked" }],
  });

  assert.equal((await ambiguous.nextAction("pay")).actor, "human");
  assert.equal((await blocked.nextAction("pay")).actor, "human");
});
