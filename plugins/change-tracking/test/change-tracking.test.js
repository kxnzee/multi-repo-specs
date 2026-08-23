/** @fileoverview Contract and domain tests for the Change Tracking Plugin. */

import assert from "node:assert/strict";
import test from "node:test";

import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin, { CycleRecord, CycleRecordRepository, SnapshotIdentity } from "../index.js";
import packageManifest from "../package.json" with { type: "json" };

testPluginContract({ plugin, packageManifest });

test("CycleRecord creates and serializes the frozen v1 contract", () => {
  const record = CycleRecord.create({
    changeId: "checkout-flow",
    planningRevision: "a".repeat(40),
    repositories: ["frontend", "backend"],
  });

  assert.equal(record.contractVersion, 1);
  assert.match(record.cycleId, /^cycle-[0-9a-f-]{36}$/);
  assert.equal(record.changeId, "checkout-flow");
  assert.equal(record.planningRevision, "a".repeat(40));
  assert.deepEqual(record.repositories, ["frontend", "backend"]);
  assert.equal(Object.isFrozen(record.repositories), true);
  assert.deepEqual(record.toDocument(), {
    contract_version: 1,
    cycle_id: record.cycleId,
    change_id: "checkout-flow",
    planning_revision: "a".repeat(40),
    repositories: ["frontend", "backend"],
    created_at: record.createdAt,
  });
});

test("CycleRecord rejects malformed and mismatched persisted records", () => {
  const document = {
    contract_version: 1,
    cycle_id: "cycle-550e8400-e29b-41d4-a716-446655440000",
    change_id: "checkout-flow",
    planning_revision: "a".repeat(40),
    repositories: ["frontend"],
    created_at: "2026-08-23T10:00:00.000Z",
  };

  assert.throws(
    () => new CycleRecord({ ...document, unexpected: true }),
    /STATE_CORRUPTED: Некорректный Cycle Record/,
  );
  assert.throws(
    () => new CycleRecord(document, { expectedChangeId: "another-change" }),
    /STATE_CORRUPTED: Cycle Record содержит change_id 'checkout-flow'/,
  );
});

test("CycleRecordRepository persists the legacy Store path through Files facade", async () => {
  const values = new Map();
  const files = Object.freeze({
    async read(relativePath, { optional } = {}) {
      if (values.has(relativePath)) return values.get(relativePath);
      if (optional) return null;
      throw new Error(`missing ${relativePath}`);
    },
    async write(relativePath, contents) {
      values.set(relativePath, contents);
    },
  });
  const repository = new CycleRecordRepository(files);
  const record = CycleRecord.create({
    changeId: "checkout-flow",
    planningRevision: "a".repeat(40),
    repositories: ["frontend"],
  });

  assert.equal(await repository.read("checkout-flow"), null);
  assert.equal(
    await repository.write(record),
    ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json",
  );
  assert.deepEqual(
    (await repository.read("checkout-flow")).toDocument(),
    record.toDocument(),
  );
});

test("CycleRecordRepository preserves corruption errors", async () => {
  const files = Object.freeze({
    async read() { return "{"; },
    async write() {},
  });
  const repository = new CycleRecordRepository(files);

  await assert.rejects(
    repository.read("checkout-flow"),
    /STATE_CORRUPTED: Cycle Record повреждён/,
  );
});

test("SnapshotIdentity follows the frozen canonical v1 projection", () => {
  const identity = new SnapshotIdentity("cycle-550e8400-e29b-41d4-a716-446655440000", [
    { repository_id: "frontend", implementation_revision: "a".repeat(40) },
    { repository_id: "backend", implementation_revision: "b".repeat(40) },
  ]);

  assert.equal(
    identity.value,
    "snap-v1-2ba71c37ac19b64b03f36a6a6a5fda8ce1c7809e6fca17619e6ac20352ca90a2",
  );
  assert.equal(String(identity), identity.value);
});
