/** @fileoverview Git publication retry contract for shared tracking state. */

import assert from "node:assert/strict";
import test from "node:test";

import { StoreGitSync } from "../lib/store-git-sync.js";

/** Creates one minimal Store context with a controllable process boundary. */
function contextWith(run) {
  return {
    repository: { id: "specs", role: "store" },
    git: {
      async assertNoOperation() {},
      async currentBranch() { return "main"; },
      async statusPaths() { return []; },
    },
    process: { run },
  };
}

test("StoreGitSync rebases and retries one rejected push", async () => {
  const calls = [];
  let pushes = 0;
  const sync = new StoreGitSync(contextWith(async (executable, args) => {
    calls.push([executable, ...args]);
    if (args[0] === "push" && pushes++ === 0) throw new Error("opaque push failure");
    return "";
  }));

  assert.deepEqual(await sync.publish(
    ["tracking/cycles/change/receipts/frontend.yaml"],
    "tracking(change): done frontend",
  ), { committed: true, pushed: true, retried: true });
  assert.deepEqual(calls.slice(-3), [
    ["git", "fetch", "origin", "main"],
    ["git", "rebase", "FETCH_HEAD"],
    ["git", "push", "origin", "main"],
  ]);
});

test("StoreGitSync aborts a conflicting retry and reports a process conflict", async () => {
  const calls = [];
  const sync = new StoreGitSync(contextWith(async (executable, args) => {
    calls.push([executable, ...args]);
    if (args[0] === "push") throw new Error("opaque push failure");
    if (args[0] === "rebase" && args[1] === "FETCH_HEAD") {
      throw new Error("CONFLICT (content)");
    }
    return "";
  }));

  await assert.rejects(
    sync.publish(
      ["tracking/cycles/change/receipts/frontend.yaml"],
      "tracking(change): done frontend",
    ),
    /TRACKING_CONFLICT:.*frontend\.yaml/u,
  );
  assert.deepEqual(calls.at(-1), ["git", "rebase", "--abort"]);
});

test("StoreGitSync preserves the original push error when remote fetch is unavailable", async () => {
  const sync = new StoreGitSync(contextWith(async (executable, args) => {
    if (args[0] === "push") throw new Error("protected branch");
    if (args[0] === "fetch") throw new Error("network unavailable");
    return "";
  }));

  await assert.rejects(
    sync.publish(
      ["tracking/cycles/change/receipts/frontend.yaml"],
      "tracking(change): done frontend",
    ),
    /protected branch/u,
  );
});

test("StoreGitSync refuses to publish files outside Plugin-owned tracking state", async () => {
  const sync = new StoreGitSync(contextWith(async () => ""));
  await assert.rejects(
    sync.publish(["openspec/project.yaml"], "unsafe"),
    /TRACKING_SYNC_INVALID/u,
  );
});
