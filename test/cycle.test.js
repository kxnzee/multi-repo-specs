/** @fileoverview Юнит- и интеграционные тесты Cycle Record: `assign` и `status`. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assignCycle } from "../src/internal/cycle/assign.js";
import { encodeChangeKey, readCycleRecord } from "../src/internal/cycle/record.js";
import { readChangeStatus } from "../src/internal/cycle/status.js";
import { runCommand } from "../src/internal/shared/command.js";
import { commitFiles, initializeGitRepository, temporaryDirectory } from "../test-fixtures/workspace.js";

const ALWAYS_CONFIRM = async () => true;
const NEVER_CONFIRM = async () => false;

/**
 * Создаёт минимальную рабочую копию Store с зарегистрированными frontend/backend.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<string>} Канонический путь Store.
 */
async function createStore(t) {
  const storeRoot = await temporaryDirectory(t, "openspec-orchestrator-cycle-");
  await initializeGitRepository(storeRoot);
  await commitFiles(storeRoot, {
    ".openspec-store/store.yaml": "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
    "openspec-orch.yaml": [
      "version: 1",
      "strict: true",
      "",
      "repositories:",
      "  - id: specs",
      "    roles: [store]",
      "    remote: https://example.test/specs.git",
      "    default_branch: main",
      "  - id: frontend",
      "    roles: [code]",
      "    remote: https://example.test/frontend.git",
      "    default_branch: main",
      "  - id: backend",
      "    roles: [code]",
      "    remote: https://example.test/backend.git",
      "    default_branch: main",
      "",
      "extensions: {}",
      "",
    ].join("\n"),
  });
  return storeRoot;
}

test("assignCycle creates a new Cycle Record after an explicit confirmation", async (t) => {
  const storeRoot = await createStore(t);
  const result = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: ALWAYS_CONFIRM,
  });

  assert.equal(result.status, "created");
  assert.match(result.cycle.cycleId, /^cycle-/);
  assert.equal(result.cycle.changeId, "checkout-flow");
  assert.deepEqual(result.cycle.repositories, ["frontend", "backend"]);
  assert.match(result.cycle.planningRevision, /^[0-9a-f]{40}$/);

  const onDisk = await readCycleRecord(storeRoot, "checkout-flow");
  assert.deepEqual(onDisk, result.cycle);
  assert.equal(
    result.path,
    path.join(storeRoot, ".openspec-orch", "changes", `${encodeChangeKey("checkout-flow")}.json`),
  );
});

test("assignCycle does not write anything when the user declines the preview", async (t) => {
  const storeRoot = await createStore(t);
  const result = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: NEVER_CONFIRM,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(await readCycleRecord(storeRoot, "checkout-flow"), null);
});

test("assignCycle is idempotent for the same planning_revision and repository set", async (t) => {
  const storeRoot = await createStore(t);
  const first = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: ALWAYS_CONFIRM,
  });

  let confirmCalls = 0;
  const second = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["backend", "frontend"],
    confirm: async () => {
      confirmCalls += 1;
      return true;
    },
  });

  assert.equal(second.status, "unchanged");
  assert.equal(second.cycle.cycleId, first.cycle.cycleId);
  assert.equal(confirmCalls, 0);
});

test("assignCycle asks again and creates a new cycle_id when the repository set changes", async (t) => {
  const storeRoot = await createStore(t);
  const first = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: ALWAYS_CONFIRM,
  });

  let preview;
  const second = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: async (value) => {
      preview = value;
      return true;
    },
  });

  assert.equal(preview.kind, "replace");
  assert.equal(preview.existing.cycleId, first.cycle.cycleId);
  assert.equal(second.status, "replaced");
  assert.notEqual(second.cycle.cycleId, first.cycle.cycleId);
  assert.deepEqual(second.cycle.repositories, ["frontend", "backend"]);
});

test("assignCycle rejects an unknown repository-id without writing a Cycle Record", async (t) => {
  const storeRoot = await createStore(t);
  await assert.rejects(
    assignCycle({
      storeRoot,
      changeId: "checkout-flow",
      repositoryIds: ["frontend", "mobile"],
      confirm: ALWAYS_CONFIRM,
    }),
    /REPO_UNKNOWN/,
  );
  assert.equal(await readCycleRecord(storeRoot, "checkout-flow"), null);
});

test("assignCycle rejects the Store repository-id as a Cycle member", async (t) => {
  const storeRoot = await createStore(t);
  await assert.rejects(
    assignCycle({
      storeRoot,
      changeId: "checkout-flow",
      repositoryIds: ["frontend", "specs"],
      confirm: ALWAYS_CONFIRM,
    }),
    /REPO_UNKNOWN/,
  );
  assert.equal(await readCycleRecord(storeRoot, "checkout-flow"), null);
});

test("readCycleRecord rejects a Cycle Record whose change_id does not match its file path", async (t) => {
  const storeRoot = await createStore(t);
  await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: ALWAYS_CONFIRM,
  });
  const recordPath = path.join(
    storeRoot,
    ".openspec-orch",
    "changes",
    `${encodeChangeKey("checkout-flow")}.json`,
  );
  const tampered = JSON.parse(await fs.readFile(recordPath, "utf8"));
  tampered.change_id = "different-change";
  await fs.writeFile(recordPath, JSON.stringify(tampered), "utf8");

  await assert.rejects(readCycleRecord(storeRoot, "checkout-flow"), /STATE_CORRUPTED/);
});

test("readCycleRecord rejects a Cycle Record with an unknown repository-id shape", async (t) => {
  const storeRoot = await createStore(t);
  await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend"],
    confirm: ALWAYS_CONFIRM,
  });
  const recordPath = path.join(
    storeRoot,
    ".openspec-orch",
    "changes",
    `${encodeChangeKey("checkout-flow")}.json`,
  );
  const tampered = JSON.parse(await fs.readFile(recordPath, "utf8"));
  tampered.repositories = ["???"];
  tampered.created_at = "not-a-date";
  await fs.writeFile(recordPath, JSON.stringify(tampered), "utf8");

  await assert.rejects(readCycleRecord(storeRoot, "checkout-flow"), /STATE_CORRUPTED/);
});

test("assignCycle refuses a dirty Store working tree without writing a Cycle Record", async (t) => {
  const storeRoot = await createStore(t);
  await fs.writeFile(path.join(storeRoot, "dirty.txt"), "uncommitted\n", "utf8");

  await assert.rejects(
    assignCycle({
      storeRoot,
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: ALWAYS_CONFIRM,
    }),
    /STORE_DIRTY/,
  );
  assert.equal(await readCycleRecord(storeRoot, "checkout-flow"), null);
});

test("assignCycle refuses a Store with an unfinished Git operation", async (t) => {
  const storeRoot = await createStore(t);
  await fs.mkdir(path.join(storeRoot, ".git", "rebase-merge"));

  await assert.rejects(
    assignCycle({
      storeRoot,
      changeId: "checkout-flow",
      repositoryIds: ["frontend"],
      confirm: ALWAYS_CONFIRM,
    }),
  );
});

test("readChangeStatus fails with CYCLE_NOT_FOUND when no Cycle Record exists", async (t) => {
  const storeRoot = await createStore(t);
  await assert.rejects(
    readChangeStatus({ storeRoot, changeId: "checkout-flow" }),
    /CYCLE_NOT_FOUND/,
  );
});

test("readChangeStatus reports an uncommitted Cycle Record and asks to commit first", async (t) => {
  const storeRoot = await createStore(t);
  await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: ALWAYS_CONFIRM,
  });

  const status = await readChangeStatus({ storeRoot, changeId: "checkout-flow" });
  assert.equal(status.committed, false);
  assert.match(status.nextAction, /закоммитьте/);
});

test("readChangeStatus survives a process restart once the Cycle Record is committed", async (t) => {
  const storeRoot = await createStore(t);
  const assigned = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: ALWAYS_CONFIRM,
  });
  await runCommand("git", ["-C", storeRoot, "add", assigned.path]);
  await runCommand("git", ["-C", storeRoot, "commit", "-m", "assign checkout-flow cycle"]);

  const status = await readChangeStatus({ storeRoot, changeId: "checkout-flow" });
  assert.equal(status.committed, true);
  assert.equal(status.cycle.cycleId, assigned.cycle.cycleId);
  assert.match(status.nextAction, /frontend/);
  assert.match(status.nextAction, /backend/);
});
