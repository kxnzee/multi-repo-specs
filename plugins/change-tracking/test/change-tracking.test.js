/** @fileoverview Contract and domain tests for the Change Tracking Plugin. */

import assert from "node:assert/strict";
import test from "node:test";
import { parse, stringify } from "yaml";

import {
  assertPluginContract,
  testPluginContract,
} from "@openspec-orch/plugin-sdk/testing";

import * as publicApi from "../index.js";
import plugin from "../index.js";
import { CycleRecord } from "../lib/cycle-record.js";
import { CycleRecordRepository } from "../lib/cycle-record-repository.js";
import { activeChangeIds } from "../lib/openspec-compatibility.js";
import { ChangeTrackingService } from "../lib/service.js";
import { snapshotId } from "../lib/snapshot-identity.js";
import packageManifest from "../package.json" with { type: "json" };
import { assignmentContext } from "./assignment-context.js";

testPluginContract({ plugin, packageManifest });

test("change-tracking contributes only the simple public evidence flow", () => {
  assert.deepEqual(
    assertPluginContract({ plugin, packageManifest }).commands,
    ["track", "done", "status", "verify"],
  );
  assert.equal(plugin.canExec(), true);
});

test("change-tracking contributes CLI evidence without an Agent Extension", () => {
  assert.equal(plugin.hasExtensionContribution(), false);
  assert.equal(packageManifest.files.includes("extension"), false);
  assert.equal(packageManifest.files.includes("template"), false);
});

test("change-tracking requires the OpenSpec 1.11 runtime contract", async () => {
  const incompatible = assignmentContext({ openSpecVersion: "1.10.0" });
  await assert.rejects(plugin.connect(incompatible), /OPENSPEC_11_REQUIRED.*1\.10\.0/u);
  await assert.rejects(
    new ChangeTrackingService(incompatible).status("checkout-flow"),
    /OPENSPEC_11_REQUIRED.*1\.10\.0/u,
  );
});

test("OpenSpec 1.11 batch preserves active identities when one Change has diagnostics", async () => {
  const process = Object.freeze({
    async run(executable, args, options) {
      assert.equal(executable, "openspec");
      assert.deepEqual(args, ["status", "--all", "--json"]);
      assert.deepEqual(options, { acceptedExitCodes: [0, 1] });
      return JSON.stringify({
        changes: [
          { changeName: "checkout-flow", artifacts: [] },
          { changeName: "broken-change", status: [{ severity: "error" }] },
        ],
      });
    },
  });

  assert.deepEqual(await activeChangeIds(process), ["checkout-flow", "broken-change"]);
});

test("change-tracking does not expose its internal service or low-level operations", () => {
  assert.deepEqual(Object.keys(publicApi), ["default"]);
  const service = new ChangeTrackingService(assignmentContext());
  for (const operation of [
    "assign",
    "currentCycle",
    "recordAssignment",
    "verify",
    "recordVerification",
  ]) {
    assert.equal(operation in service, false);
  }
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

test("CycleRecordRepository persists the Git-native Store path through Files facade", async () => {
  const values = new Map();
  const files = Object.freeze({
    async listDirectories() { return Object.freeze([]); },
    async listFiles(relativePath, { optional } = {}) {
      const prefix = `${relativePath}/`;
      const names = [...values.keys()]
        .filter((value) => value.startsWith(prefix) && !value.slice(prefix.length).includes("/"))
        .map((value) => value.slice(prefix.length))
        .sort();
      if (names.length === 0 && !optional) throw new Error(`missing ${relativePath}`);
      return Object.freeze(names);
    },
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
    "tracking/cycles/checkout-flow/cycle.yaml",
  );
  assert.deepEqual(
    (await repository.read("checkout-flow")).toDocument(),
    record.toDocument(),
  );
});

test("CycleRecordRepository preserves corruption errors", async () => {
  const files = Object.freeze({
    async listDirectories() { return Object.freeze([]); },
    async listFiles() { return Object.freeze([]); },
    async read() { return "{"; },
    async write() {},
  });
  const repository = new CycleRecordRepository(files);

  await assert.rejects(
    repository.read("checkout-flow"),
    /STATE_CORRUPTED: Cycle Record повреждён/,
  );
});

test("ChangeTrackingService creates and preserves evidence scope through track", async () => {
  const service = new ChangeTrackingService(assignmentContext());
  const input = { changeId: "checkout-flow" };

  const created = await service.track(input);
  const unchanged = await service.track(input);
  const current = await service.status("checkout-flow");

  assert.equal(current.changeId, "checkout-flow");
  assert.equal(created.changed, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.cycle.cycleId, created.cycle.cycleId);
  assert.equal(current.cycle.cycleId, created.cycle.cycleId);
  assert.equal(current.committed, true);
  assert.equal(current.releaseReady, false);
  assert.equal(created.path, "tracking/cycles/checkout-flow/cycle.yaml");
});

test("statuses overlays tracked evidence on every active OpenSpec Change", async () => {
  const activeChanges = ["checkout-flow", "payments-flow"];
  const context = assignmentContext({ activeChanges });
  const service = new ChangeTrackingService(context);
  await service.track({ changeId: "checkout-flow" });

  const statuses = await service.statuses();

  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].changeId, "checkout-flow");
  assert.equal(statuses[0].tracked, true);
  assert.equal(statuses[0].releaseReady, false);
  assert.deepEqual(statuses[0].cycle.repositories, ["frontend", "backend"]);
  assert.deepEqual(statuses[1], {
    changeId: "payments-flow",
    tracked: false,
  });

  activeChanges.length = 0;
  assert.deepEqual(await service.statuses(), []);
});

test("track delegates the Apply-ready Planning gate to OpenSpec 1.11", async () => {
  const service = new ChangeTrackingService(assignmentContext({ applyReady: false }));

  await assert.rejects(
    service.track({ changeId: "checkout-flow" }),
    /PLANNING_INCOMPLETE/u,
  );
});

test("zero-argument done resolves active Changes through OpenSpec 1.11 batch status", async () => {
  const activeChanges = ["checkout-flow"];
  const context = assignmentContext({
    activeChanges,
    impactRepositories: ["frontend"],
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  });
  const service = new ChangeTrackingService(context);
  await service.track({ changeId: "checkout-flow" });

  activeChanges.length = 0;
  await assert.rejects(
    service.done({ source: "human" }),
    /CYCLE_NOT_FOUND: для repository-id 'frontend' нет активного Cycle/u,
  );
});

test("ChangeTrackingService reports missing and uncommitted evidence scope", async () => {
  const path = "tracking/cycles/checkout-flow/cycle.yaml";
  const service = new ChangeTrackingService(assignmentContext({
    changedPaths: [path],
    impactRepositories: ["frontend"],
  }));
  await assert.rejects(service.status("checkout-flow"), /CYCLE_NOT_FOUND/);

  await service.track({ changeId: "checkout-flow" });
  const current = await service.status("checkout-flow");
  assert.equal(current.committed, false);
  assert.equal(current.path, path);
});

test("ChangeTrackingService rejects invalid Repository Impact and dirty Store", async () => {
  const dirty = new ChangeTrackingService(assignmentContext({ changedPaths: ["README.md"] }));
  await assert.rejects(
    dirty.track({ changeId: "checkout-flow" }),
    /STORE_DIRTY/,
  );
  await assert.rejects(
    new ChangeTrackingService(assignmentContext({ impactRepositories: ["specs"] })).track({
      changeId: "checkout-flow",
    }),
    /Cycle принимает только roles: \[code\]/,
  );
  await assert.rejects(
    new ChangeTrackingService(assignmentContext({
      connected: [],
      impactRepositories: ["frontend"],
    })).track({ changeId: "checkout-flow" }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("ChangeTrackingService reports an unknown persisted repository as corrupted state", async () => {
  const context = assignmentContext({ impactRepositories: ["frontend"] });
  await context.files.write(
    "tracking/cycles/checkout-flow/cycle.yaml",
    stringify({
      contract_version: 1,
      cycle_id: "cycle-550e8400-e29b-41d4-a716-446655440000",
      change_id: "checkout-flow",
      planning_revision: "a".repeat(40),
      repositories: ["removed-repository"],
      created_at: "2026-08-23T10:00:00.000Z",
    }),
  );
  const service = new ChangeTrackingService(context);

  await assert.rejects(
    service.track({ changeId: "checkout-flow" }),
    /STATE_CORRUPTED: Cycle Record содержит неизвестный Code Repository 'removed-repository'/,
  );
});

test("done appends and supersedes implementation revisions", async () => {
  const heads = { frontend: "a".repeat(40) };
  const context = assignmentContext({
    impactRepositories: ["frontend"],
    implementationHeads: heads,
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  });
  const service = new ChangeTrackingService(context);
  await service.track({ changeId: "checkout-flow" });

  const created = await service.done({ changeId: "checkout-flow", source: "human" });
  heads.frontend = "b".repeat(40);
  const replaced = await service.done({ changeId: "checkout-flow", source: "human" });
  const journal = parse(await context.files.read(replaced.result.path));

  assert.deepEqual(journal.receipts, [created.result.receipt, replaced.result.receipt]);
  assert.equal(replaced.result.receipt.supersedes, created.result.receipt.receipt_id);
});

test("done blocks an uncommitted scope or unavailable commit", async () => {
  const path = "tracking/cycles/checkout-flow/cycle.yaml";
  const invocation = { id: "frontend", role: "code", path: "/workspace/frontend" };
  const uncommitted = new ChangeTrackingService(assignmentContext({
    changedPaths: [path],
    impactRepositories: ["frontend"],
    invocation,
  }));
  await uncommitted.track({ changeId: "checkout-flow" });
  await assert.rejects(
    uncommitted.done({ changeId: "checkout-flow", source: "human" }),
    /CYCLE_NOT_COMMITTED/,
  );

  const missing = new ChangeTrackingService(assignmentContext({
    impactRepositories: ["frontend"],
    implementationAvailable: false,
    invocation,
  }));
  await missing.track({ changeId: "checkout-flow" });
  await assert.rejects(
    missing.done({ changeId: "checkout-flow", source: "human" }),
    /COMMIT_NOT_FOUND: commit/,
  );
});

test("done and verifyResult maintain current and stale verification", async () => {
  const heads = { frontend: "a".repeat(40) };
  const context = assignmentContext({
    impactRepositories: ["frontend"],
    implementationHeads: heads,
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  });
  const service = new ChangeTrackingService(context);
  await service.track({ changeId: "checkout-flow" });

  const missing = await service.status("checkout-flow");
  assert.equal(missing.repositories[0].receipt, null);
  assert.equal(missing.releaseReady, false);

  const firstDone = await service.done({
    changeId: "checkout-flow",
    source: "agent",
  });
  const createdVerification = await service.verifyResult({
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
  });
  const ready = await service.status("checkout-flow");

  assert.equal(ready.snapshot.snapshot_id, firstDone.snapshot.snapshot_id);
  assert.equal(ready.snapshot.current, true);
  assert.equal(ready.verification.current, true);
  assert.equal(ready.releaseReady, true);

  heads.frontend = "b".repeat(40);
  await service.done({ changeId: "checkout-flow", source: "agent" });
  const stale = await service.status("checkout-flow");
  assert.equal(stale.snapshot.current, true);
  assert.equal(stale.verification.current, false);
  assert.equal(stale.releaseReady, false);
  const replacedVerification = await service.verifyResult({
    changeId: "checkout-flow",
    result: "fail",
    source: "human",
  });
  const journal = parse(await context.files.read(replacedVerification.path));

  assert.deepEqual(journal.verifications, [replacedVerification.receipt]);
  assert.equal(
    replacedVerification.receipt.supersedes,
    createdVerification.receipt.receipt_id,
  );
});

test("status keeps shared evidence after repository disconnect", async () => {
  const connected = ["frontend"];
  const context = assignmentContext({
    connected,
    impactRepositories: ["frontend"],
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  });
  const service = new ChangeTrackingService(context);
  await service.track({ changeId: "checkout-flow" });
  await service.done({ changeId: "checkout-flow", source: "agent" });

  connected.length = 0;
  const status = await service.status("checkout-flow");
  assert.equal(status.repositories[0].connected, false);
  assert.equal(status.repositories[0].receipt.implementation_revision, "a".repeat(40));
  await assert.rejects(
    service.done({ changeId: "checkout-flow", source: "agent" }),
    /PLUGIN_NOT_CONNECTED/,
  );
});

test("verifyResult requires revisions for the whole evidence scope", async () => {
  const service = new ChangeTrackingService(assignmentContext({
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  }));
  await service.track({ changeId: "checkout-flow" });
  await service.done({ changeId: "checkout-flow", source: "ci" });

  await assert.rejects(
    service.verifyResult({ changeId: "checkout-flow", result: "pass", source: "ci" }),
    /SNAPSHOT_MISMATCH: .*backend.*implementation revision/,
  );
});

test("verifyResult accepts decisions only from a human or CI", async () => {
  const service = new ChangeTrackingService(assignmentContext({
    impactRepositories: ["frontend"],
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
  }));
  await service.track({ changeId: "checkout-flow" });
  await service.done({ changeId: "checkout-flow", source: "agent" });

  await assert.rejects(
    service.verifyResult({
      changeId: "checkout-flow",
      result: "pass",
      source: "agent",
    }),
    /VERIFY_SOURCE_INVALID/u,
  );
});

test("snapshotId follows the canonical v1 projection", () => {
  const identity = snapshotId("cycle-550e8400-e29b-41d4-a716-446655440000", [
    { repository_id: "frontend", implementation_revision: "a".repeat(40) },
    { repository_id: "backend", implementation_revision: "b".repeat(40) },
  ]);

  assert.equal(
    identity,
    "snap-v1-0877570c1ce261025a08129dd51afb9fb9fb39b450be4d5f105a82900c11cdd5",
  );
});

test("snapshotId changes when current receipt changes at the same implementation SHA", () => {
  const cycleId = "cycle-550e8400-e29b-41d4-a716-446655440000";
  const implementation = {
    repository_id: "frontend",
    implementation_revision: "a".repeat(40),
  };
  const first = snapshotId(cycleId, [{
    ...implementation,
    receipt_id: "result-550e8400-e29b-41d4-a716-446655440001",
  }]);
  const second = snapshotId(cycleId, [{
    ...implementation,
    receipt_id: "result-550e8400-e29b-41d4-a716-446655440002",
  }]);

  assert.notEqual(first, second);
});
