/** @fileoverview Human-readable terminal status presentation. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStatusDetails,
  formatStatusHeading,
  presentState,
} from "../internal/status-output.js";

test("status headings use stable icons and readable state labels", () => {
  assert.equal(formatStatusHeading("codegraph → frontend", "ready"), (
    "✓ codegraph → frontend — готов"
  ));
  assert.equal(formatStatusHeading("codegraph → backend", "stale"), (
    "⚠ codegraph → backend — требует обновления"
  ));
  assert.equal(formatStatusHeading("sample → mobile", "unavailable"), (
    "✗ sample → mobile — недоступен"
  ));
  assert.deepEqual(presentState("custom"), { icon: "•", label: "custom" });
});

test("structured Plugin details render as a readable tree instead of JSON", () => {
  const details = JSON.stringify({
    initialized: true,
    index: { state: "complete", files: 73 },
    pendingChanges: { added: 0, modified: 2 },
  });

  assert.deepEqual(formatStatusDetails(details), [
    "├─ initialized: да",
    "├─ index",
    "│  ├─ state: complete",
    "│  └─ files: 73",
    "└─ pending changes",
    "   ├─ added: 0",
    "   └─ modified: 2",
  ]);
  assert.deepEqual(formatStatusDetails("line one\nline two"), ["line one", "line two"]);
});
