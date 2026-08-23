/** @fileoverview Contract and domain tests for the Change Tracking Plugin. */

import assert from "node:assert/strict";
import test from "node:test";

import { testPluginContract } from "@openspec-orch/plugin-sdk/testing";

import plugin, {
  CycleAssignmentService,
  CycleRecord,
  CycleRecordRepository,
  SnapshotIdentity,
} from "../index.js";
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

/** Creates an in-memory Store PluginContext for assign tests. */
function assignmentContext({ changedPaths = [], connected = ["frontend", "backend"] } = {}) {
  const values = new Map();
  const repositories = new Map([
    ["specs", Object.freeze({ id: "specs", role: "store" })],
    ["frontend", Object.freeze({ id: "frontend", role: "code" })],
    ["backend", Object.freeze({ id: "backend", role: "code" })],
  ]);
  return Object.freeze({
    repository: repositories.get("specs"),
    repositories: Object.freeze({
      require(repositoryId) {
        const repository = repositories.get(repositoryId);
        if (!repository) throw new Error(`REPO_UNKNOWN: ${repositoryId}`);
        return repository;
      },
      requireConnected(repositoryIds) {
        for (const repositoryId of repositoryIds) {
          if (!connected.includes(repositoryId)) {
            throw new Error(`PLUGIN_NOT_CONNECTED: change-tracking не подключён к ${repositoryId}`);
          }
        }
        return Object.freeze(repositoryIds.map((repositoryId) => repositories.get(repositoryId)));
      },
    }),
    git: Object.freeze({
      async assertNoOperation() {},
      async statusPaths() { return changedPaths; },
      async revision() { return "a".repeat(40); },
    }),
    files: Object.freeze({
      async read(relativePath, { optional } = {}) {
        if (values.has(relativePath)) return values.get(relativePath);
        if (optional) return null;
        throw new Error(`missing ${relativePath}`);
      },
      async write(relativePath, contents) { values.set(relativePath, contents); },
    }),
  });
}

test("CycleAssignmentService creates and then preserves an unchanged Cycle", async () => {
  const service = new CycleAssignmentService(assignmentContext());
  const previews = [];
  const input = {
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: async (preview) => {
      previews.push(preview);
      return true;
    },
  };

  const created = await service.assign(input);
  const unchanged = await service.assign(input);

  assert.equal(created.status, "created");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.cycle.cycleId, created.cycle.cycleId);
  assert.equal(created.path, ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json");
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].repositories, ["frontend", "backend"]);
});

test("CycleAssignmentService preserves preview cancellation without writing", async () => {
  const service = new CycleAssignmentService(assignmentContext());
  const result = await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => false,
  });

  assert.deepEqual(result, {
    status: "cancelled",
    path: ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json",
  });
});

test("CycleAssignmentService rejects invalid scope and dirty Store before preview", async () => {
  const dirty = new CycleAssignmentService(assignmentContext({ changedPaths: ["README.md"] }));
  await assert.rejects(
    dirty.assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /STORE_DIRTY/,
  );
  await assert.rejects(
    new CycleAssignmentService(assignmentContext()).assign({
      changeId: "checkout-flow",
      repositoryIds: ["specs"],
      confirm: async () => true,
    }),
    /Cycle принимает только roles: \[code\]/,
  );
  await assert.rejects(
    new CycleAssignmentService(assignmentContext({ connected: [] })).assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("CycleAssignmentService reports an unknown persisted repository as corrupted state", async () => {
  const context = assignmentContext();
  await context.files.write(
    ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json",
    `${JSON.stringify({
      contract_version: 1,
      cycle_id: "cycle-550e8400-e29b-41d4-a716-446655440000",
      change_id: "checkout-flow",
      planning_revision: "a".repeat(40),
      repositories: ["removed-repository"],
      created_at: "2026-08-23T10:00:00.000Z",
    })}\n`,
  );
  const service = new CycleAssignmentService(context);

  await assert.rejects(
    service.assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository 'removed-repository'/,
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
