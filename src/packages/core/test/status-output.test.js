/** @fileoverview Human-readable terminal status presentation. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  formatStatusDetails,
} from "../internal/status-output.js";

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
