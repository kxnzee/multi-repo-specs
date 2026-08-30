/** @fileoverview Shared Change Tracking application policy contract. */

import assert from "node:assert/strict";
import test from "node:test";

import { ChangeTrackingApplication } from "../lib/application.js";

test("next action keeps verification and Release outside Agent ownership", async () => {
  const base = {
    changeId: "pay",
    tracked: true,
    committed: true,
    cycle: { repositories: ["frontend"] },
    repositories: [{ repositoryId: "frontend", receipt: null, headMatches: null }],
    snapshot: null,
    verification: null,
  };
  const batches = [];
  const application = new ChangeTrackingApplication(Object.freeze({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
  }), {
    service: Object.freeze({ statuses: async () => batches.at(-1) }),
  });

  batches.push([base]);
  assert.deepEqual(await application.getNextAction("pay"), {
    action: "record_result_receipt",
    actor: "agent",
    reason: "Для Repository ещё нет receipt",
    change_id: "pay",
    repository_id: "frontend",
  });

  batches.push([{
    ...base,
    repositories: [{ repositoryId: "frontend", receipt: {}, headMatches: true }],
    snapshot: { snapshot_id: "snap" },
    verification: { current: true, result: "pass" },
  }]);
  assert.equal((await application.getNextAction("pay")).actor, "human");
});
