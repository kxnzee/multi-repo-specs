/** @fileoverview Сквозные интеграционные тесты Cycle, Receipts и Snapshot. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assignCycle } from "../src/internal/cycle/assign.js";
import { readChangeStatus } from "../src/internal/cycle/status.js";
import { recordAssignment } from "../src/internal/receipt/assignment.js";
import { recordVerification } from "../src/internal/receipt/verification.js";
import { computeSnapshotId, verifyCycle } from "../src/internal/snapshot/index.js";
import { readState } from "../src/internal/state/index.js";
import { runCommand } from "../src/internal/shared/command.js";
import {
  commitFiles,
  createCheckoutWithRemote,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const ALWAYS_CONFIRM = async () => true;

test("computeSnapshotId follows the frozen canonical v1 projection", () => {
  assert.equal(
    computeSnapshotId("cycle-550e8400-e29b-41d4-a716-446655440000", [
      { repository_id: "frontend", implementation_revision: "a".repeat(40) },
      { repository_id: "backend", implementation_revision: "b".repeat(40) },
    ]),
    "snap-v1-2ba71c37ac19b64b03f36a6a6a5fda8ce1c7809e6fca17619e6ac20352ca90a2",
  );
});

/**
 * Создаёт стандартный pilot workspace и закоммиченный Cycle для frontend/backend.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @param {{commitCycle?: boolean}} [options] Коммитить ли Cycle Record.
 * @returns {Promise<{storeRoot: string, frontendRoot: string, backendRoot: string}>}
 */
async function createPilotCycle(t, { commitCycle = true } = {}) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-pilot-flow-");
  const { checkout: storeRoot, remote: storeRemote } = await createCheckoutWithRemote(
    root,
    "workspace/specs",
    "specs",
    { "openspec/config.yaml": "schema: spec-driven\n" },
  );
  const { checkout: frontendRoot, remote: frontendRemote } = await createCheckoutWithRemote(
    root,
    "workspace/src/frontend",
    "frontend",
    { "README.md": "frontend\n" },
  );
  const { checkout: backendRoot, remote: backendRemote } = await createCheckoutWithRemote(
    root,
    "workspace/src/backend",
    "backend",
    { "README.md": "backend\n" },
  );
  await writeFiles(storeRoot, {
    ".gitignore": ".openspec-orch/state.json\n",
    ".openspec-store/store.yaml": `version: 1\nid: specs\nremote: ${JSON.stringify(storeRemote)}\n`,
    "openspec-orch.yaml": [
      "version: 1",
      "strict: true",
      "repositories:",
      `  - { id: specs, roles: [store], remote: ${JSON.stringify(storeRemote)}, default_branch: main }`,
      `  - { id: frontend, roles: [code], remote: ${JSON.stringify(frontendRemote)}, default_branch: main }`,
      `  - { id: backend, roles: [code], remote: ${JSON.stringify(backendRemote)}, default_branch: main }`,
      "extensions: {}",
      "",
    ].join("\n"),
  });
  await commitFiles(storeRoot, {}, { message: "configure pilot store" });
  const assigned = await assignCycle({
    storeRoot,
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: ALWAYS_CONFIRM,
  });
  if (commitCycle) {
    await runCommand("git", ["-C", storeRoot, "add", assigned.path]);
    await runCommand("git", ["-C", storeRoot, "commit", "-m", "assign checkout-flow"]);
  }
  return { storeRoot, frontendRoot, backendRoot };
}

test("recordAssignment persists a current Result Receipt for an existing commit", async (t) => {
  const scenario = await createPilotCycle(t);
  const revision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);

  const result = await recordAssignment({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: revision,
    status: "completed",
    source: "human",
    note: "frontend ready",
    confirm: ALWAYS_CONFIRM,
  });

  assert.equal(result.status, "created");
  assert.equal(result.receipt.repository_id, "frontend");
  assert.equal(result.receipt.implementation_revision, revision);
  assert.equal(result.receipt.status, "completed");
  const state = await readState(scenario.storeRoot);
  assert.deepEqual(state.result_receipts, [result.receipt]);
});

test("recordAssignment blocks an uncommitted Cycle without creating local state", async (t) => {
  const scenario = await createPilotCycle(t, { commitCycle: false });
  const revision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);

  await assert.rejects(
    recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: revision,
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    }),
    /CYCLE_NOT_COMMITTED/,
  );
  assert.equal(
    await fs.stat(path.join(scenario.storeRoot, ".openspec-orch", "state.json")).catch(() => null),
    null,
  );
});

test("recordAssignment rejects an absent commit without partial state", async (t) => {
  const scenario = await createPilotCycle(t);

  await assert.rejects(
    recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: "f".repeat(40),
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    }),
    /COMMIT_NOT_FOUND/,
  );
  assert.equal(
    await fs.stat(path.join(scenario.storeRoot, ".openspec-orch", "state.json")).catch(() => null),
    null,
  );
});

test("recordAssignment replaces the current Receipt and preserves its history", async (t) => {
  const scenario = await createPilotCycle(t);
  const revision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);
  const first = await recordAssignment({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: revision,
    status: "blocked",
    source: "human",
    confirm: ALWAYS_CONFIRM,
  });
  const second = await recordAssignment({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: revision,
    status: "completed",
    source: "agent",
    confirm: ALWAYS_CONFIRM,
  });

  assert.equal(second.status, "replaced");
  const state = await readState(scenario.storeRoot);
  assert.deepEqual(state.result_receipts, [second.receipt]);
  assert.deepEqual(state.result_receipt_history, [first.receipt]);
});

test("recordAssignment does not overwrite a corrupted state file", async (t) => {
  const scenario = await createPilotCycle(t);
  const statePath = path.join(scenario.storeRoot, ".openspec-orch", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, "not json", "utf8");
  const revision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);

  await assert.rejects(
    recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: revision,
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    }),
    /STATE_CORRUPTED/,
  );
  assert.equal(await fs.readFile(statePath, "utf8"), "not json");
});

test("recordAssignment rejects a Result Receipt when the Cycle changes after preview", async (t) => {
  const scenario = await createPilotCycle(t);
  const revision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);

  await assert.rejects(
    recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId: "frontend",
      implementationRevision: revision,
      status: "completed",
      source: "human",
      confirm: async () => {
        await commitFiles(scenario.storeRoot, { "planning.txt": "new baseline\n" }, { message: "new planning" });
        const next = await assignCycle({
          storeRoot: scenario.storeRoot,
          changeId: "checkout-flow",
          repositoryIds: ["frontend", "backend"],
          confirm: ALWAYS_CONFIRM,
        });
        await runCommand("git", ["-C", scenario.storeRoot, "add", next.path]);
        await runCommand("git", ["-C", scenario.storeRoot, "commit", "-m", "replace cycle"]);
        return true;
      },
    }),
    /CYCLE_MISMATCH/,
  );
  assert.deepEqual((await readState(scenario.storeRoot)).result_receipts, []);
});

test("verifyCycle blocks an incomplete result set without writing a Snapshot", async (t) => {
  const scenario = await createPilotCycle(t);
  const frontendRevision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);
  await recordAssignment({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: frontendRevision,
    status: "completed",
    source: "human",
    confirm: ALWAYS_CONFIRM,
  });

  await assert.rejects(
    verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" }),
    /CYCLE_MISMATCH/,
  );
  assert.deepEqual((await readState(scenario.storeRoot)).snapshots, []);
});

test("verify and record verification persist a deterministic current Snapshot", async (t) => {
  const scenario = await createPilotCycle(t);
  const frontendRevision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);
  const backendRevision = await runCommand("git", ["-C", scenario.backendRoot, "rev-parse", "HEAD"]);
  for (const [repositoryId, implementationRevision] of [
    ["frontend", frontendRevision],
    ["backend", backendRevision],
  ]) {
    await recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId,
      implementationRevision,
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    });
  }

  const first = await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
  const second = await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
  assert.equal(second.snapshot.snapshot_id, first.snapshot.snapshot_id);
  assert.match(first.snapshot.snapshot_id, /^snap-v1-[0-9a-f]{64}$/);
  assert.deepEqual(first.snapshot.implementations, {
    backend: backendRevision,
    frontend: frontendRevision,
  });

  const recorded = await recordVerification({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
    note: "manual checks passed",
    confirm: ALWAYS_CONFIRM,
  });
  assert.equal(recorded.status, "created");
  assert.equal(recorded.receipt.snapshot_id, first.snapshot.snapshot_id);

  const state = await readState(scenario.storeRoot);
  assert.deepEqual(state.snapshots, [first.snapshot]);
  assert.deepEqual(state.verification_receipts, [recorded.receipt]);
});

test("recordVerification rejects a Snapshot made stale by a replaced Result Receipt", async (t) => {
  const scenario = await createPilotCycle(t);
  const frontendRevision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);
  const backendRevision = await runCommand("git", ["-C", scenario.backendRoot, "rev-parse", "HEAD"]);
  for (const [repositoryId, implementationRevision] of [
    ["frontend", frontendRevision],
    ["backend", backendRevision],
  ]) {
    await recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId,
      implementationRevision,
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    });
  }
  await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });

  await commitFiles(scenario.frontendRoot, { "result.txt": "second result\n" }, { message: "second frontend result" });
  const nextFrontendRevision = await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]);
  await recordAssignment({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    repositoryId: "frontend",
    implementationRevision: nextFrontendRevision,
    status: "completed",
    source: "agent",
    confirm: ALWAYS_CONFIRM,
  });

  await assert.rejects(
    recordVerification({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      result: "pass",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    }),
    /SNAPSHOT_MISMATCH/,
  );
  assert.deepEqual((await readState(scenario.storeRoot)).verification_receipts, []);
});

test("recordVerification rejects a Verification Receipt when the Snapshot changes after preview", async (t) => {
  const scenario = await createPilotCycle(t);
  for (const [repositoryId, repositoryRoot] of [
    ["frontend", scenario.frontendRoot],
    ["backend", scenario.backendRoot],
  ]) {
    await recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId,
      implementationRevision: await runCommand("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    });
  }
  await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });

  await assert.rejects(
    recordVerification({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      result: "pass",
      source: "human",
      confirm: async () => {
        await commitFiles(scenario.frontendRoot, { "late.txt": "late result\n" }, { message: "late result" });
        await recordAssignment({
          storeRoot: scenario.storeRoot,
          changeId: "checkout-flow",
          repositoryId: "frontend",
          implementationRevision: await runCommand("git", ["-C", scenario.frontendRoot, "rev-parse", "HEAD"]),
          status: "completed",
          source: "human",
          confirm: ALWAYS_CONFIRM,
        });
        await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
        return true;
      },
    }),
    /SNAPSHOT_MISMATCH/,
  );
  assert.deepEqual((await readState(scenario.storeRoot)).verification_receipts, []);
});

test("status restores the complete verified flow and reports missing after state loss", async (t) => {
  const scenario = await createPilotCycle(t);
  for (const [repositoryId, repositoryRoot] of [
    ["frontend", scenario.frontendRoot],
    ["backend", scenario.backendRoot],
  ]) {
    await recordAssignment({
      storeRoot: scenario.storeRoot,
      changeId: "checkout-flow",
      repositoryId,
      implementationRevision: await runCommand("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
      status: "completed",
      source: "human",
      confirm: ALWAYS_CONFIRM,
    });
  }
  await verifyCycle({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
  await recordVerification({
    storeRoot: scenario.storeRoot,
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
    confirm: ALWAYS_CONFIRM,
  });

  const complete = await readChangeStatus({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
  assert.deepEqual(complete.repositories.map(({ state }) => state), ["completed", "completed"]);
  assert.equal(complete.snapshot.current, true);
  assert.equal(complete.verification.current, true);
  assert.equal(complete.nextAction, "готово");

  await fs.rm(path.join(scenario.storeRoot, ".openspec-orch", "state.json"));
  const restored = await readChangeStatus({ storeRoot: scenario.storeRoot, changeId: "checkout-flow" });
  assert.deepEqual(restored.repositories.map(({ state }) => state), ["missing", "missing"]);
  assert.equal(restored.snapshot, null);
  assert.equal(restored.verification, null);
  assert.match(restored.nextAction, /записать результаты/);
});
