/** @fileoverview Проверка строгой обработки машинных ответов OpenSpec. */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createOpenSpecClient } from "../src/internal/shared/openspec-client.js";
import {
  assertOpenSpecRoot,
  assertOpenSpecStore,
  parseOpenSpecRoot,
  parseOpenSpecJson,
} from "../src/internal/shared/openspec-model.js";
import { assertStoreDoctor } from "../src/internal/shared/store.js";
import {
  assertRepositoryId,
  isGitRevision,
  isOpenSpecResponse,
  isRepositoryId,
} from "../src/internal/shared/schema.js";

test("parseOpenSpecJson rejects invalid JSON", () => {
  assert.throws(() => parseOpenSpecJson("not-json", "openspec doctor"));
  assert.throws(() => parseOpenSpecJson("[]", "openspec doctor"));
  assert.throws(
    () => parseOpenSpecJson('{"root":{"path":42},"status":[]}', "openspec doctor"),
  );
  assert.throws(
    () => parseOpenSpecJson('{"status":"ready"}', "openspec doctor"),
  );
  assert.throws(
    () => parseOpenSpecJson('{"status":[{"severity":42}]}', "openspec doctor"),
  );
});

test("OpenSpecClient only executes OpenSpec in its bound cwd", async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    return "ok";
  };
  const client = createOpenSpecClient("/workspace/specs", runner);

  assert.equal(await client.execute(["doctor"], { environment: { NODE_NO_WARNINGS: "1" } }), "ok");
  assert.deepEqual(calls, [{
    command: "openspec",
    args: ["doctor"],
    options: {
      environment: { NODE_NO_WARNINGS: "1" },
      cwd: "/workspace/specs",
    },
  }]);
});

test("shared schema validates OpenSpec responses and full Git revisions", () => {
  assert.equal(isOpenSpecResponse({ status: [] }), true);
  assert.equal(isOpenSpecResponse({ status: "ready" }), false);
  assert.equal(isGitRevision("a".repeat(40)), true);
  assert.equal(isGitRevision("a".repeat(39)), false);
  assert.equal(isGitRevision("A".repeat(40)), false);
});

test("repository ID predicate and assertion enforce the same string contract", () => {
  assert.equal(isRepositoryId("payments-api"), true);
  assert.equal(assertRepositoryId("payments-api"), "payments-api");
  for (const invalid of [42, null, "Payments-API", "payments_api"]) {
    assert.equal(isRepositoryId(invalid), false);
    assert.throws(() => assertRepositoryId(invalid));
  }
});

test("assertOpenSpecRoot rejects another Store", () => {
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/specs", store_id: "other", source: "store" },
      { path: "/tmp/specs", storeId: "expected", source: "store" },
      "openspec doctor",
    ),
  );
});

test("assertOpenSpecRoot rejects another root path", () => {
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/other", store_id: "specs", source: "store" },
      { path: "/tmp/specs", storeId: "specs", source: "store" },
      "openspec doctor",
    ),
  );
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/specs", store_id: "specs", source: "declared" },
      { path: "/tmp/specs", storeId: "specs", source: "store" },
      "openspec doctor",
    ),
  );
  assert.throws(
    () => assertOpenSpecRoot({}, { path: "/tmp/specs", storeId: "specs", source: "store" }, "openspec doctor"),
  );
});

test("OpenSpec root errors distinguish contract incompatibility from identity mismatch", () => {
  assert.throws(
    () => parseOpenSpecRoot({}, "openspec context --json"),
    /OpenSpec Orchestrator не может обработать ответ `openspec context --json`/,
  );
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/other", store_id: "specs", source: "store" },
      { path: "/tmp/specs", storeId: "specs", source: "store" },
      "openspec context --json",
    ),
    /OpenSpec Orchestrator ожидал root\.path/,
  );
});

test("assertOpenSpecStore requires the expected Store ID and root", () => {
  assert.doesNotThrow(() => assertOpenSpecStore(
    { id: "specs", root: "/tmp/specs" },
    { path: "/tmp/specs", storeId: "specs" },
    "openspec store setup",
  ));
  assert.throws(
    () => assertOpenSpecStore(
      { id: "other", root: "/tmp/specs" },
      { path: "/tmp/specs", storeId: "specs" },
      "openspec store setup",
    ),
    /OpenSpec Orchestrator ожидал Store specs/,
  );
});

test("Store doctor errors distinguish its JSON contract from an unhealthy Store", () => {
  const projectRoot = path.resolve("/tmp/specs");
  assert.throws(
    () => assertStoreDoctor({ stores: [{ id: "specs" }] }, "specs", projectRoot),
    /OpenSpec Orchestrator не может обработать ответ `openspec store doctor specs --json`/,
  );
  assert.throws(
    () => assertStoreDoctor({
      stores: [{
        id: "specs",
        root: projectRoot,
        metadata: { present: true, valid: true },
        openspec_root: { healthy: false },
      }],
    }, "specs", projectRoot),
    /Store specs не прошёл проверку здоровья/,
  );
});
