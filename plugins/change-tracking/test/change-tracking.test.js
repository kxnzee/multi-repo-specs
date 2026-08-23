/** @fileoverview Contract and domain tests for the Change Tracking Plugin. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPluginContract,
  testPluginContract,
} from "@openspec-orch/plugin-sdk/testing";

import plugin, {
  ChangeTrackingService,
  CycleRecord,
  CycleRecordRepository,
  SnapshotIdentity,
} from "../index.js";
import packageManifest from "../package.json" with { type: "json" };
import { assignmentContext } from "./assignment-context.js";

testPluginContract({ plugin, packageManifest });

test("change-tracking contributes only the preserved root command set", () => {
  assert.deepEqual(
    assertPluginContract({ plugin, packageManifest }).commands,
    ["assign", "status", "record", "verify"],
  );
});

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

test("ChangeTrackingService creates and then preserves an unchanged Cycle", async () => {
  const service = new ChangeTrackingService(assignmentContext());
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
  const current = await service.currentCycle("checkout-flow");

  assert.equal(created.status, "created");
  assert.equal(unchanged.status, "unchanged");
  assert.equal(unchanged.cycle.cycleId, created.cycle.cycleId);
  assert.equal(current.cycle.cycleId, created.cycle.cycleId);
  assert.equal(current.committed, true);
  assert.equal(created.path, ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json");
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].repositories, ["frontend", "backend"]);
});

test("ChangeTrackingService reports missing and uncommitted Cycle records", async () => {
  const path = ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json";
  const service = new ChangeTrackingService(assignmentContext({ changedPaths: [path] }));
  await assert.rejects(service.currentCycle("checkout-flow"), /CYCLE_NOT_FOUND/);

  await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });
  const current = await service.currentCycle("checkout-flow");
  assert.equal(current.committed, false);
  assert.equal(current.path, path);
});

test("ChangeTrackingService preserves preview cancellation without writing", async () => {
  const service = new ChangeTrackingService(assignmentContext());
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

test("ChangeTrackingService rejects invalid scope and dirty Store before preview", async () => {
  const dirty = new ChangeTrackingService(assignmentContext({ changedPaths: ["README.md"] }));
  await assert.rejects(
    dirty.assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /STORE_DIRTY/,
  );
  await assert.rejects(
    new ChangeTrackingService(assignmentContext()).assign({
      changeId: "checkout-flow",
      repositoryIds: ["specs"],
      confirm: async () => true,
    }),
    /Cycle принимает только roles: \[code\]/,
  );
  await assert.rejects(
    new ChangeTrackingService(assignmentContext({ connected: [] })).assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("ChangeTrackingService reports an unknown persisted repository as corrupted state", async () => {
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
  const service = new ChangeTrackingService(context);

  await assert.rejects(
    service.assign({
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: async () => true,
    }),
    /STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository 'removed-repository'/,
  );
});

test("ChangeTrackingService records and replaces a Result Receipt with history", async () => {
  const context = assignmentContext();
  const service = new ChangeTrackingService(context);
  await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });
  const base = {
    changeId: "checkout-flow",
    repositoryId: "frontend",
    status: "completed",
    source: "human",
    confirm: async () => true,
  };

  const created = await service.recordAssignment({
    ...base,
    implementationRevision: "a".repeat(40),
  });
  const replaced = await service.recordAssignment({
    ...base,
    implementationRevision: "b".repeat(40),
  });
  const state = await context.storage.read();

  assert.equal(created.status, "created");
  assert.equal(created.headMatches, true);
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.headMatches, false);
  assert.equal(replaced.replaced.receipt_id, created.receipt.receipt_id);
  assert.deepEqual(state.result_receipt_history, [created.receipt]);
});

test("ChangeTrackingService blocks Result Receipt without committed Cycle or commit", async () => {
  const path = ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json";
  const uncommitted = new ChangeTrackingService(
    assignmentContext({ changedPaths: [path] }),
  );
  await uncommitted.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });
  await assert.rejects(
    uncommitted.recordAssignment({
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: "a".repeat(40),
      status: "completed",
      source: "human",
      confirm: async () => true,
    }),
    /CYCLE_NOT_COMMITTED/,
  );

  const missing = new ChangeTrackingService(
    assignmentContext({ implementationAvailable: false }),
  );
  await missing.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });
  await assert.rejects(
    missing.recordAssignment({
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: "a".repeat(40),
      status: "completed",
      source: "human",
      confirm: async () => true,
    }),
    /COMMIT_NOT_FOUND: commit/,
  );
});

test("ChangeTrackingService verifies, records verification and reports current status", async () => {
  const context = assignmentContext();
  const service = new ChangeTrackingService(context);
  await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });

  const missing = await service.status("checkout-flow");
  assert.equal(missing.repositories[0].state, "missing");
  assert.equal(missing.nextAction, "записать результаты для репозиториев: frontend");

  await service.recordAssignment({
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: "a".repeat(40),
    status: "completed",
    source: "agent",
    confirm: async () => true,
  });
  const createdSnapshot = await service.verify("checkout-flow");
  const unchangedSnapshot = await service.verify("checkout-flow");
  const createdVerification = await service.recordVerification({
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
    confirm: async () => true,
  });
  const ready = await service.status("checkout-flow");

  assert.equal(createdSnapshot.status, "created");
  assert.equal(unchangedSnapshot.status, "unchanged");
  assert.equal(createdVerification.status, "created");
  assert.equal(ready.snapshot.current, true);
  assert.equal(ready.verification.current, true);
  assert.equal(ready.nextAction, "готово");

  await service.recordAssignment({
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: "b".repeat(40),
    status: "completed",
    source: "agent",
    confirm: async () => true,
  });
  const stale = await service.status("checkout-flow");
  assert.equal(stale.snapshot.current, false);
  assert.equal(stale.verification.current, false);
  assert.equal(stale.nextAction, "вызвать verify");
  await assert.rejects(
    service.recordVerification({
      changeId: "checkout-flow",
      result: "fail",
      source: "human",
      confirm: async () => true,
    }),
    /SNAPSHOT_MISMATCH: сначала вызовите verify/,
  );

  const replacementSnapshot = await service.verify("checkout-flow");
  const replacedVerification = await service.recordVerification({
    changeId: "checkout-flow",
    result: "fail",
    source: "human",
    confirm: async () => true,
  });
  const state = await context.storage.read();

  assert.equal(replacementSnapshot.status, "created");
  assert.equal(replacedVerification.status, "replaced");
  assert.equal(replacedVerification.replaced.receipt_id, createdVerification.receipt.receipt_id);
  assert.deepEqual(state.verification_receipt_history, [createdVerification.receipt]);
});

test("ChangeTrackingService keeps read-only history after repository disconnect", async () => {
  const connected = ["frontend"];
  const context = assignmentContext({ connected });
  const service = new ChangeTrackingService(context);
  await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: async () => true,
  });
  await service.recordAssignment({
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: "a".repeat(40),
    status: "completed",
    source: "agent",
    confirm: async () => true,
  });

  connected.length = 0;
  const status = await service.status("checkout-flow");
  assert.equal(status.repositories[0].state, "disconnected");
  assert.equal(status.repositories[0].receipt.implementation_revision, "a".repeat(40));
  await assert.rejects(
    service.recordAssignment({
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: "a".repeat(40),
      status: "completed",
      source: "agent",
      confirm: async () => true,
    }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("ChangeTrackingService verify requires completed results for the whole Cycle", async () => {
  const service = new ChangeTrackingService(assignmentContext());
  await service.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: async () => true,
  });
  await service.recordAssignment({
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: "a".repeat(40),
    status: "completed",
    source: "ci",
    confirm: async () => true,
  });

  await assert.rejects(
    service.verify("checkout-flow"),
    /CYCLE_MISMATCH: для repository-id 'backend' нужен текущий Result Receipt completed/,
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
