/** @fileoverview Recovery must attempt every independent compensation and retain failures. */
import assert from "node:assert/strict";
import test from "node:test";
import { rollbackOrRethrow } from "../internal/compensation.js";

test("rollback continues after failure and retains the original and all cleanup errors", async () => {
  const original = new Error("publish failed");
  const errors = [new Error("third failed"), new Error("second failed")];
  const visited = [];
  await assert.rejects(rollbackOrRethrow(original, [1, 2, 3], async (id) => {
    visited.push(id);
    if (id > 1) throw errors[3 - id];
  }, "ROLLBACK_FAILED"), (error) => {
    assert.deepEqual(visited, [3, 2, 1]);
    assert.deepEqual(error.errors, [original, ...errors]);
    assert.equal(error.cause, original);
    return true;
  });
});
