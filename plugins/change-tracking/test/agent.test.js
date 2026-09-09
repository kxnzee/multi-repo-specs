/** @fileoverview Governed operations delegate to Tracking without transport-owned business rules. */
import assert from "node:assert/strict";
import test from "node:test";
import { changeTrackingAgentContribution as agent } from "../lib/agent.js";

test("Tracking binds abstract operations and preserves application results and errors", () => {
  const input = { change_id: "pay", task_id: "1" };
  const expected = { changeId: "pay", taskId: "1" };
  const result = { revision: "implementation" };
  const failure = new Error("ATTEMPT_IMPLEMENTATION_MISSING");
  assert.equal(agent.operations.start_attempt({ startAttempt(args) {
    assert.deepEqual(args, expected); return result;
  } }, input), result);
  assert.throws(() => agent.operations.complete_attempt({ completeAttempt(args) {
    assert.deepEqual(args, expected); throw failure;
  } }, input), (error) => error === failure);
  assert.throws(() => agent.operations.start_attempt(null, input), /CAPABILITY_UNAVAILABLE/u);
});

test("Tracking owns status overlays and preserves other capabilities", async () => {
  const tracking = { attempts: [] };
  const application = { getStatus(changeId) { assert.equal(changeId, "pay"); return tracking; } };
  const result = { capabilities: { graph: { available: true } } };
  const enhanced = await agent.enhance({ application, operation: "getStatus", input: { change_id: "pay" }, result });
  assert.equal(enhanced.capabilities.graph, result.capabilities.graph);
  assert.deepEqual(enhanced.capabilities.tracking, { provider: "change-tracking", available: true });
  assert.equal(enhanced.tracking, tracking);
  const context = await agent.enhance({ application, operation: "getChangeContext", input: { change_id: "pay" }, result: {} });
  assert.deepEqual(context, { tracking });
  const unavailable = await agent.enhance({ application: null, operation: "getStatus", input: {}, result });
  assert.equal(unavailable.capabilities.tracking.available, false);
  assert.equal(unavailable.tracking, null);
});
