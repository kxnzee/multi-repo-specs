/** @fileoverview Shared OpenSpec application recommendations used by protocol adapters. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RepositoryFiles, RepositoryOpenSpec } from "@openspec-orch/core";

/** Creates a scoped facade that returns canonical status and Apply fixtures. */
function repositoryOpenSpec(status, applyInstructions) {
  return new RepositoryOpenSpec(
    { root: "/store" },
    {
      cwd: "/store",
      run: async (_executable, args) => {
        if (args[0] === "status") {
          assert.deepEqual(args, ["status", "--change", "pay", "--json"]);
          return JSON.stringify(status);
        }
        assert.deepEqual(args, ["instructions", "apply", "--change", "pay", "--json"]);
        return JSON.stringify(applyInstructions);
      },
    },
  );
}

test("OpenSpec application derives a ready artifact without MCP-owned workflow policy", async () => {
  const application = repositoryOpenSpec({
    changeName: "pay",
    artifacts: [
      { id: "proposal", status: "done", requires: [] },
      { id: "design", status: "ready", requires: ["proposal"] },
    ],
    applyRequires: ["design"],
  });

  assert.deepEqual(await application.nextAction("pay"), {
    action: "prepare_artifact",
    actor: "agent",
    reason: "OpenSpec разблокировал следующий artifact",
    change_id: "pay",
    artifact: "design",
  });
});

test("OpenSpec application leaves ambiguous and blocked transitions to a human", async () => {
  const ambiguous = repositoryOpenSpec({
    artifacts: [
      { id: "design", status: "ready" },
      { id: "specs", status: "ready" },
    ],
  });
  const blocked = repositoryOpenSpec({
    artifacts: [{ id: "tasks", status: "blocked" }],
  });

  assert.equal((await ambiguous.nextAction("pay")).actor, "human");
  assert.equal((await blocked.nextAction("pay")).actor, "human");
});

test("OpenSpec application keeps Apply ahead of a ready post-implementation artifact", async () => {
  const status = {
    artifacts: [
      { id: "implementation-plan", status: "done" },
      { id: "feature-acceptance", status: "ready" },
    ],
    applyRequires: ["implementation-plan"],
  };
  const pending = repositoryOpenSpec(status, {
    state: "ready",
    progress: { total: 2, complete: 1, remaining: 1 },
  });
  const complete = repositoryOpenSpec(status, {
    state: "all_done",
    progress: { total: 2, complete: 2, remaining: 0 },
  });
  const untracked = repositoryOpenSpec(status, {
    state: "ready",
    progress: { total: 0, complete: 0, remaining: 0 },
  });

  assert.deepEqual(await pending.nextAction("pay"), {
    action: "apply_change",
    actor: "agent",
    reason: "OpenSpec сообщил о незавершённых Apply tasks",
    change_id: "pay",
  });
  assert.deepEqual(await complete.nextAction("pay"), {
    action: "prepare_artifact",
    actor: "agent",
    reason: "OpenSpec разблокировал следующий artifact",
    change_id: "pay",
    artifact: "feature-acceptance",
  });
  assert.deepEqual(await untracked.nextAction("pay"), {
    action: "consult_change_context",
    actor: "agent",
    reason: "OpenSpec не сообщил однозначный прогресс Apply",
    change_id: "pay",
  });
});

test("OpenSpec application stops automation after every Apply task is complete", async () => {
  const application = repositoryOpenSpec({
    isPlanningComplete: true,
    isComplete: true,
    artifacts: [
      { id: "tasks", status: "done" },
      { id: "verify", status: "done" },
    ],
    applyRequires: ["tasks"],
  }, {
    state: "all_done",
    progress: { total: 2, complete: 2, remaining: 0 },
  });

  assert.deepEqual(await application.nextAction("pay"), {
    action: "no_automatic_action",
    actor: "human",
    reason: "OpenSpec Apply завершён и не объявил следующий автоматический artifact",
    change_id: "pay",
  });
});

test("OpenSpec application does not route to Verify from blocked or inconsistent Apply progress", async () => {
  for (const instructions of [
    { state: "blocked", progress: { total: 2, complete: 1, remaining: 1 } },
    { state: "all_done", progress: { total: 2, complete: 1, remaining: 1 } },
    { state: "all_done", progress: { total: 2, complete: 2, remaining: 1 } },
    { state: "all_done" },
  ]) {
    const application = repositoryOpenSpec({
      artifacts: [{ id: "tasks", status: "done" }, { id: "verify", status: "ready" }],
      applyRequires: ["tasks"],
    }, instructions);
    assert.equal((await application.nextAction("pay")).action, "consult_change_context");
  }
});

test("OpenSpec application updates one exact Store task without rewriting its description", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-task-progress-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const taskPath = path.join(root, "openspec/changes/pay/tasks.md");
  await fs.mkdir(path.dirname(taskPath), { recursive: true });
  await fs.writeFile(
    taskPath,
    "# Tasks\r\n\r\n- [ ] 1.1 Keep first\r\n- [ ] 1.2 Complete second\r\n",
  );
  const instructions = [
    {
      changeName: "pay",
      contextFiles: { tasks: [taskPath] },
      tasks: [
        { id: "1", description: "1.1 Keep first", done: false },
        { id: "2", description: "1.2 Complete second", done: false },
      ],
      progress: { total: 2, complete: 0, remaining: 2 },
    },
    {
      changeName: "pay",
      contextFiles: { tasks: [taskPath] },
      tasks: [
        { id: "1", description: "1.1 Keep first", done: false },
        { id: "2", description: "1.2 Complete second", done: true },
      ],
      progress: { total: 2, complete: 1, remaining: 1 },
    },
  ];
  const application = new RepositoryOpenSpec(
    { root, role: "store", id: "specs" },
    {
      cwd: root,
      run: async (_executable, args) => {
        assert.deepEqual(args, ["instructions", "apply", "--change", "pay", "--json"]);
        return JSON.stringify(instructions.shift());
      },
    },
    new RepositoryFiles({ root }),
  );

  assert.deepEqual(await application.setTaskCompletion("pay", "2", true), {
    change_id: "pay",
    task_id: "2",
    completed: true,
    changed: true,
    progress: { total: 2, complete: 1, remaining: 1 },
  });
  assert.equal(
    await fs.readFile(taskPath, "utf8"),
    "# Tasks\r\n\r\n- [ ] 1.1 Keep first\r\n- [x] 1.2 Complete second\r\n",
  );
});
