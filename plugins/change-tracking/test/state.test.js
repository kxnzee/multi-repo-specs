/** @fileoverview Change Tracking state aggregate and storage tests. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ChangeTrackingState,
  ChangeTrackingStore,
  SnapshotIdentity,
} from "../index.js";

const CYCLE_ID = "cycle-550e8400-e29b-41d4-a716-446655440000";
const CREATED_AT = "2026-08-23T10:00:00.000Z";

/** Creates one valid Result Receipt document. */
function resultReceipt(receiptId, revision = "a".repeat(40)) {
  return {
    contract_version: 1,
    receipt_id: `result-${receiptId}`,
    cycle_id: CYCLE_ID,
    repository_id: "frontend",
    implementation_revision: revision,
    status: "completed",
    source: "human",
    created_at: CREATED_AT,
  };
}

test("ChangeTrackingState owns current Result Receipt and replacement history", () => {
  const first = resultReceipt("550e8400-e29b-41d4-a716-446655440001");
  const second = resultReceipt(
    "550e8400-e29b-41d4-a716-446655440002",
    "b".repeat(40),
  );
  const state = new ChangeTrackingState().recordResult(first).recordResult(second);

  assert.deepEqual(state.result(CYCLE_ID, "frontend"), second);
  assert.deepEqual(state.resultsFor(CYCLE_ID), [second]);
  assert.deepEqual(state.toDocument().result_receipt_history, [first]);
  assert.equal(Object.isFrozen(state.toDocument()), true);
});

test("ChangeTrackingState validates Snapshot identity and Verification history", () => {
  const implementations = { frontend: "a".repeat(40) };
  const snapshotId = new SnapshotIdentity(CYCLE_ID, [{
    repository_id: "frontend",
    implementation_revision: implementations.frontend,
  }]).value;
  const snapshot = {
    contract_version: 1,
    snapshot_id: snapshotId,
    cycle_id: CYCLE_ID,
    implementations,
    created_at: CREATED_AT,
  };
  const first = {
    contract_version: 1,
    receipt_id: "verification-550e8400-e29b-41d4-a716-446655440003",
    cycle_id: CYCLE_ID,
    snapshot_id: snapshotId,
    result: "pass",
    source: "ci",
    created_at: CREATED_AT,
  };
  const second = {
    ...first,
    receipt_id: "verification-550e8400-e29b-41d4-a716-446655440004",
    result: "fail",
  };
  const state = new ChangeTrackingState()
    .recordSnapshot(snapshot)
    .recordVerification(first)
    .recordVerification(second);

  assert.deepEqual(state.snapshot(CYCLE_ID), snapshot);
  assert.deepEqual(state.verification(CYCLE_ID), second);
  assert.deepEqual(state.toDocument().verification_receipt_history, [first]);
  assert.equal(Object.isFrozen(state.snapshot(CYCLE_ID).implementations), true);
  assert.throws(
    () => new ChangeTrackingState().recordSnapshot({ ...snapshot, snapshot_id: `snap-v1-${"0".repeat(64)}` }),
    /не соответствует содержимому Snapshot/,
  );
});

test("ChangeTrackingStore maps null storage and atomic update to the domain model", async () => {
  let document = null;
  const storage = Object.freeze({
    async read() { return document; },
    async update(operation) {
      document = await operation(document);
      return document;
    },
  });
  const store = new ChangeTrackingStore(storage);

  assert.deepEqual((await store.read()).toDocument().result_receipts, []);
  const updated = await store.update((state) => state.recordResult(
    resultReceipt("550e8400-e29b-41d4-a716-446655440005"),
  ));
  assert.equal(updated.resultsFor(CYCLE_ID).length, 1);
  assert.equal((await store.read()).resultsFor(CYCLE_ID).length, 1);
});

test("ChangeTrackingState rejects unknown fields and duplicate current records", () => {
  const receipt = resultReceipt("550e8400-e29b-41d4-a716-446655440006");
  assert.throws(
    () => new ChangeTrackingState({ contract_version: 1, unexpected: true }),
    /STATE_CORRUPTED/,
  );
  assert.throws(
    () => new ChangeTrackingState({
      contract_version: 1,
      result_receipts: [receipt, receipt],
    }),
    /повторяющуюся пару cycle\/repository/,
  );
});
