/** @fileoverview Проверка строгой обработки машинных ответов OpenSpec. */

import assert from "node:assert/strict";
import test from "node:test";
import { assertOpenSpecRoot, parseOpenSpecJson } from "../shared/openspec.js";
import { isGitRevision, isOpenSpecResponse } from "../shared/schema.js";

test("parseOpenSpecJson rejects invalid JSON", () => {
  assert.throws(() => parseOpenSpecJson("not-json", "openspec doctor"), /невалидный JSON/);
  assert.throws(() => parseOpenSpecJson("[]", "openspec doctor"), /OpenSpec JSON response/);
  assert.throws(
    () => parseOpenSpecJson('{"root":{"path":42},"status":[]}', "openspec doctor"),
    /OpenSpec JSON response/,
  );
  assert.throws(
    () => parseOpenSpecJson('{"status":"ready"}', "openspec doctor"),
    /OpenSpec JSON response/,
  );
  assert.throws(
    () => parseOpenSpecJson('{"status":[{"severity":42}]}', "openspec doctor"),
    /некорректную OpenSpec diagnostic/,
  );
});

test("shared schema validates OpenSpec responses and full Git revisions", () => {
  assert.equal(isOpenSpecResponse({ status: [] }), true);
  assert.equal(isOpenSpecResponse({ status: "ready" }), false);
  assert.equal(isGitRevision("a".repeat(40)), true);
  assert.equal(isGitRevision("a".repeat(39)), false);
  assert.equal(isGitRevision("A".repeat(40)), false);
});

test("assertOpenSpecRoot rejects another Store", () => {
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/specs", store_id: "other", source: "store" },
      { path: "/tmp/specs", storeId: "expected", source: "store" },
      "openspec doctor",
    ),
    /Store ID other, ожидался expected/,
  );
});

test("assertOpenSpecRoot rejects another root path", () => {
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/other", store_id: "specs", source: "store" },
      { path: "/tmp/specs", storeId: "specs", source: "store" },
      "openspec doctor",
    ),
    /другой OpenSpec root/,
  );
  assert.throws(
    () => assertOpenSpecRoot(
      { path: "/tmp/specs", store_id: "specs", source: "declared" },
      { path: "/tmp/specs", storeId: "specs", source: "store" },
      "openspec doctor",
    ),
    /source: declared/,
  );
  assert.throws(
    () => assertOpenSpecRoot({}, { path: "/tmp/specs", storeId: "specs", source: "store" }, "openspec doctor"),
    /корректный OpenSpec root/,
  );
});
