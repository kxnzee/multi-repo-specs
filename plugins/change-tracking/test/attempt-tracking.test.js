/** @fileoverview Narrow task-to-revision attempt flow for Change Tracking. */

import assert from "node:assert/strict";
import test from "node:test";
import { parse, stringify } from "yaml";

import { AttemptTrackingService } from "../lib/attempt-service.js";
import { ImplementationMapRepository } from "../lib/implementation-map-repository.js";
import { assignmentContext } from "./assignment-context.js";

const BASE = "a".repeat(40);
const IMPLEMENTATION = "b".repeat(40);

test("attempt rejects display numbers and recovers with the canonical OpenSpec ID", async () => {
  const tasks = [{ id: "4", description: "2.3 Handle errors", done: false }];
  const heads = { frontend: BASE };
  const context = assignmentContext({
    invocation: { id: "frontend", role: "code", path: "/workspace/frontend" },
    implementationHeads: heads,
    tasks,
  });
  const service = new AttemptTrackingService(context);
  const before = await context.storage.read();
  await assert.rejects(service.start({ changeId: "checkout-flow", taskId: "2.3" }), (error) => {
    assert.match(error.message, /ATTEMPT_TASK_NOT_FOUND:.*tasks\[\].id/u);
    assert.doesNotMatch(error.message, /get_change_context|artifact_instructions|tracking\.active/u);
    return true;
  });
  assert.deepEqual(await context.storage.read(), before);
  const started = await service.start({ changeId: "checkout-flow", taskId: "4" });
  assert.deepEqual(started.task, { id: "4", description: "2.3 Handle errors" });
  const active = await context.storage.read();
  await assert.rejects(service.complete({ changeId: "checkout-flow", taskId: "2.3" }), (error) => {
    assert.match(error.message, /ATTEMPT_NOT_FOUND:.*активной attempt/u);
    assert.doesNotMatch(error.message, /start_attempt|tracking\.active|get_change_context/u);
    return true;
  });
  assert.deepEqual(await context.storage.read(), active);
  assert.equal(tasks[0].done, false, "attempt tools must not mark task checkboxes");
  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  const result = await service.complete({ changeId: "checkout-flow", taskId: started.task.id });
  assert.deepEqual(result.attempt.task, started.task);
});

test("attempt starts locally and completes once into the owning Change manifest", async () => {
  const tasks = [{ id: "1", description: "1.1 Implement checkout", done: false }];
  const heads = { frontend: BASE };
  const context = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "C:\\workspace\\frontend" }),
    implementationHeads: heads,
    schemaName: "custom-team-schema",
    tasks,
  });
  const service = new AttemptTrackingService(context, {
    now: () => "2026-08-31T10:00:00.000Z",
  });

  const started = await service.start({ changeId: "checkout-flow", taskId: "1" });
  assert.equal(started.stored, "local");
  assert.equal(started.base_revision, BASE);
  assert.equal(
    await context.files.read(
      "openspec/changes/checkout-flow/implementation-map.yaml",
      { optional: true },
    ),
    null,
  );

  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  const completed = await service.complete({ changeId: "checkout-flow", taskId: "1" });
  assert.equal(completed.stored, "change");
  assert.equal(completed.path, "openspec/changes/checkout-flow/implementation-map.yaml");
  assert.equal(completed.attempt.implementation_revision, IMPLEMENTATION);

  const manifest = parse(await context.files.read(completed.path));
  assert.deepEqual(manifest, {
    contract_version: 1,
    change_id: "checkout-flow",
    attempts: [{
      repository_id: "frontend",
      task: { id: "1", description: "1.1 Implement checkout" },
      schema_name: "custom-team-schema",
      planning_revision: BASE,
      base_revision: BASE,
      implementation_revision: IMPLEMENTATION,
      started_at: "2026-08-31T10:00:00.000Z",
      completed_at: "2026-08-31T10:00:00.000Z",
    }],
  });
  assert.deepEqual(await service.status("checkout-flow"), {
    change_id: "checkout-flow",
    path: completed.path,
    active: [],
    cancelled: [],
    completed: manifest.attempts,
  });
});

test("a reopened OpenSpec task keeps each implementation attempt", async () => {
  const tasks = [{ id: "1", description: "1.1 Implement checkout", done: false }];
  const heads = { frontend: BASE };
  const timestamps = [
    "2026-08-31T10:00:00.000Z",
    "2026-08-31T10:01:00.000Z",
    "2026-08-31T11:00:00.000Z",
    "2026-08-31T11:01:00.000Z",
  ];
  const context = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
    implementationHeads: heads,
    tasks,
  });
  const service = new AttemptTrackingService(context, { now: () => timestamps.shift() });

  await service.start({ changeId: "checkout-flow", taskId: "1" });
  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  await service.complete({ changeId: "checkout-flow", taskId: "1" });

  tasks[0].done = false;
  await service.start({ changeId: "checkout-flow", taskId: "1" });
  tasks[0].done = true;
  heads.frontend = "c".repeat(40);
  await service.complete({ changeId: "checkout-flow", taskId: "1" });

  const status = await service.status("checkout-flow");
  assert.deepEqual(
    status.completed.map(({ base_revision, implementation_revision }) => ({
      base_revision,
      implementation_revision,
    })),
    [
      { base_revision: BASE, implementation_revision: IMPLEMENTATION },
      { base_revision: IMPLEMENTATION, implementation_revision: "c".repeat(40) },
    ],
  );
});

test("complete requires the standard OpenSpec Apply checkbox and a clean Code Repository", async () => {
  const tasks = [{ id: "1", description: "1.1 Implement checkout", done: false }];
  const context = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
    tasks,
  });
  const service = new AttemptTrackingService(context);
  await service.start({ changeId: "checkout-flow", taskId: "1" });

  await assert.rejects(
    service.complete({ changeId: "checkout-flow", taskId: "1" }),
    /ATTEMPT_TASK_INCOMPLETE/u,
  );
});

test("complete requires an implementation commit after attempt start", async () => {
  const tasks = [{ id: "1", description: "1.1 Implement checkout", done: false }];
  const context = assignmentContext({
    invocation: Object.freeze({ id: "frontend", role: "code", path: "/workspace/frontend" }),
    implementationHeads: { frontend: BASE },
    tasks,
  });
  const service = new AttemptTrackingService(context);
  await service.start({ changeId: "checkout-flow", taskId: "1" });

  tasks[0].done = true;
  await assert.rejects(
    service.complete({ changeId: "checkout-flow", taskId: "1" }),
    /ATTEMPT_IMPLEMENTATION_MISSING/u,
  );
});

test("attempt binds task identity to OpenSpec output, not schema headings", async () => {
  const tasks = [{ id: "custom-7", description: "Build custom operation", done: false }];
  const context = assignmentContext({
    invocation: Object.freeze({ id: "backend", role: "code", path: "/workspace/backend" }),
    schemaName: "renamed-operations",
    tasks,
  });
  const service = new AttemptTrackingService(context);

  const started = await service.start({ changeId: "checkout-flow", taskId: "custom-7" });
  assert.equal(started.task.description, "Build custom operation");
  assert.equal(started.schema_name, "renamed-operations");
  await assert.rejects(
    service.start({ changeId: "checkout-flow", taskId: "missing" }),
    /ATTEMPT_TASK_NOT_FOUND/u,
  );
});

test("implementation map completion is retry-safe when only completion time changes", async () => {
  const context = assignmentContext();
  const repository = new ImplementationMapRepository(context.files);
  const attempt = {
    repository_id: "frontend",
    task: { id: "1", description: "Implement checkout" },
    schema_name: "spec-driven-extended",
    planning_revision: BASE,
    base_revision: BASE,
    implementation_revision: IMPLEMENTATION,
    started_at: "2026-08-31T10:00:00.000Z",
    completed_at: "2026-08-31T10:01:00.000Z",
  };

  assert.equal((await repository.append("checkout-flow", attempt)).changed, true);
  assert.equal((await repository.append("checkout-flow", {
    ...attempt,
    completed_at: "2026-08-31T10:02:00.000Z",
  })).changed, false);
});

test("implementation map keeps concurrent completions for different tasks", async () => {
  const context = assignmentContext();
  const repository = new ImplementationMapRepository(context.files);
  const attempt = (taskId, implementationRevision) => ({
    repository_id: "frontend",
    task: { id: taskId, description: `Implement task ${taskId}` },
    schema_name: "spec-driven-extended",
    planning_revision: BASE,
    base_revision: BASE,
    implementation_revision: implementationRevision,
    started_at: "2026-08-31T10:00:00.000Z",
    completed_at: "2026-08-31T10:01:00.000Z",
  });

  const results = await Promise.all([
    repository.append("checkout-flow", attempt("1", IMPLEMENTATION)),
    repository.append("checkout-flow", attempt("2", "c".repeat(40))),
  ]);

  assert.deepEqual(results.map(({ changed }) => changed), [true, true]);
  assert.deepEqual(
    (await repository.read("checkout-flow")).map(({ task }) => task.id),
    ["1", "2"],
  );
});

test("implementation map retries a transient Core file-update lock", async () => {
  const context = assignmentContext();
  let updates = 0;
  const files = Object.freeze({
    read: context.files.read.bind(context.files),
    async update(...args) {
      updates += 1;
      if (updates === 1) {
        throw Object.assign(new Error("FILE_UPDATE_BUSY: retry"), { code: "FILE_UPDATE_BUSY" });
      }
      return context.files.update(...args);
    },
  });
  const repository = new ImplementationMapRepository(files);

  const result = await repository.append("checkout-flow", {
    repository_id: "frontend",
    task: { id: "1", description: "Implement checkout" },
    schema_name: "spec-driven-extended",
    planning_revision: BASE,
    base_revision: BASE,
    implementation_revision: IMPLEMENTATION,
    started_at: "2026-08-31T10:00:00.000Z",
    completed_at: "2026-08-31T10:01:00.000Z",
  });

  assert.equal(result.changed, true);
  assert.equal(updates, 2);
});


test("completion remains idempotent after YAML keys are reordered", async () => {
  const context = assignmentContext();
  const repository = new ImplementationMapRepository(context.files);
  const attempt = {
    repository_id: "frontend", task: { id: "1", description: "Implement checkout" },
    schema_name: "spec-driven-extended", planning_revision: BASE, base_revision: BASE,
    implementation_revision: IMPLEMENTATION, started_at: "2026-08-31T10:00:00.000Z",
    completed_at: "2026-08-31T10:01:00.000Z",
  };
  const result = await repository.append("checkout-flow", attempt);
  const document = parse(await context.files.read(result.path));
  document.attempts[0] = Object.fromEntries(Object.entries(attempt).reverse());
  document.attempts[0].task = { description: attempt.task.description, id: attempt.task.id };
  await context.files.update(result.path, () => stringify(document));
  assert.equal((await repository.append("checkout-flow", attempt)).changed, false);
  assert.equal((await repository.read("checkout-flow")).length, 1);
});


test("completion holds the local lock against cancellation and duplicate completion", async () => {
  const tasks = [{ id: "1", description: "Implement checkout", done: false }];
  const heads = { frontend: BASE };
  const context = assignmentContext({ invocation: { id: "frontend", role: "code" }, implementationHeads: heads, tasks });
  let release, entered;
  const held = new Promise((resolve) => { release = resolve; });
  const waiting = new Promise((resolve) => { entered = resolve; });
  const service = new AttemptTrackingService({ ...context, files: { ...context.files,
    async update(...args) { entered(); await held; return context.files.update(...args); },
  } });
  const input = { changeId: "checkout-flow", taskId: "1" };
  await service.start(input);
  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  const completing = service.complete(input);
  try {
    await waiting;
    await assert.rejects(service.cancel({ ...input, reason: "changed plan" }), /PLUGIN_STORAGE_BUSY/u);
    await assert.rejects(service.complete(input), /PLUGIN_STORAGE_BUSY/u);
  } finally { release(); await completing; }
  tasks[0].done = false;
  const reopened = await service.start(input);
  const status = await service.status(input.changeId);
  assert.equal(status.active[0].base_revision, reopened.base_revision);
  assert.equal(status.completed.length, 1);
  assert.deepEqual(status.cancelled, []);
});

test("corrupt active attempts fail closed with a diagnostic instead of a TypeError", async () => {
  const context = assignmentContext();
  const corrupt = { contract_version: 1, active_attempts: [null] };
  await context.storage.update(() => corrupt);
  await assert.rejects(new AttemptTrackingService(context).status("checkout-flow"), /PLUGIN_STORAGE_CORRUPTED/);
  assert.deepEqual(await context.storage.read(), corrupt);
});

test("attempt rejects uncommitted planning and preserves active state on unrelated history", async () => {
  const tasks = [{ id: "1", description: "Implement", done: false }];
  const planningChangedPaths = ["openspec/changes/checkout-flow/tasks.md"];
  const heads = { frontend: BASE };
  const context = assignmentContext({ invocation: { id: "frontend", role: "code" },
    tasks, planningChangedPaths, implementationHeads: heads, ancestor: false });
  const service = new AttemptTrackingService(context);
  await assert.rejects(service.start({ changeId: "checkout-flow", taskId: "1" }), /PLANNING_WORKTREE_DIRTY/u);
  assert.equal(await context.storage.read(), null);
  planningChangedPaths.length = 0;
  await service.start({ changeId: "checkout-flow", taskId: "1" });
  const before = await context.storage.read();
  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  await assert.rejects(service.complete({ changeId: "checkout-flow", taskId: "1" }), /ATTEMPT_HISTORY_CHANGED/u);
  assert.deepEqual(await context.storage.read(), before);
  assert.equal(await context.files.read("openspec/changes/checkout-flow/implementation-map.yaml", { optional: true }), null);
});

test("changed task can be cancelled with a reason and restarted without losing history", async () => {
  const tasks = [{ id: "1", description: "Original task", done: false }];
  const context = assignmentContext({ invocation: { id: "frontend", role: "code" }, tasks });
  const tracker = new AttemptTrackingService(context);
  const input = { changeId: "checkout-flow", taskId: "1" };
  await tracker.start(input);
  // Existing v1 local state remains readable and is upgraded only on a successful write.
  await context.storage.update(({ active_attempts }) => ({ contract_version: 1, active_attempts }));
  assert.equal((await tracker.status(input.changeId)).active.length, 1);
  assert.equal((await context.storage.read()).contract_version, 1);
  tasks[0].description = "Revised task";
  await assert.rejects(tracker.start(input), /ATTEMPT_TASK_CHANGED/u);
  await assert.rejects(tracker.cancel({ ...input, reason: " " }), /ATTEMPT_REASON_REQUIRED/u);
  await assert.rejects(tracker.cancel({ ...input, taskId: "other", reason: "changed" }), /ATTEMPT_NOT_FOUND/u);
  assert.equal((await tracker.status(input.changeId)).active.length, 1);
  const result = await tracker.cancel({ ...input, reason: "  revised requirements  " });
  assert.equal(result.reason, "revised requirements");
  assert.equal(result.attempt.task.description, "Original task");
  assert.equal((await context.storage.read()).contract_version, 2);
  const status = await tracker.status(input.changeId);
  assert.equal(status.active.length, 0);
  assert.equal(status.cancelled.length, 1);
  assert.deepEqual(status.completed, []);
  assert.equal((await tracker.start(input)).task.description, "Revised task");
  assert.equal((await tracker.status(input.changeId)).cancelled.length, 1);
});

test("cancellation cannot contradict durable completion after interrupted local cleanup", async () => {
  const tasks = [{ id: "1", description: "Implement", done: false }];
  const heads = { frontend: BASE };
  const context = assignmentContext({ invocation: { id: "frontend", role: "code" }, tasks, implementationHeads: heads });
  const tracker = new AttemptTrackingService(context);
  const input = { changeId: "checkout-flow", taskId: "1" };
  await tracker.start(input);
  const before = await context.storage.read();
  tasks[0].done = true;
  heads.frontend = IMPLEMENTATION;
  await tracker.complete(input);
  // Simulates a crash after durable map write but before the local state replacement.
  await context.storage.update(() => before);
  await assert.rejects(tracker.cancel({ ...input, reason: "cancel stale attempt" }), /ATTEMPT_ALREADY_COMPLETED/u);
  assert.deepEqual((await tracker.status(input.changeId)).cancelled, []);
  await tracker.complete(input);
  const status = await tracker.status(input.changeId);
  assert.equal(status.active.length, 0);
  assert.equal(status.completed.length, 1);
});

test("completion recovers durable evidence after task and Git state change", async () => {
  for (const removeTask of [false, true]) {
    const tasks = [{ id: "1", description: "Original", done: false }];
    const heads = { frontend: BASE };
    const context = assignmentContext({ invocation: { id: "frontend", role: "code" }, tasks, implementationHeads: heads });
    const tracker = new AttemptTrackingService(context);
    const input = { changeId: "checkout-flow", taskId: "1" };
    await tracker.start(input);
    const before = await context.storage.read();
    tasks[0].done = true;
    heads.frontend = IMPLEMENTATION;
    const completed = await tracker.complete(input);
    await context.storage.update(() => before);
    tasks[0].description = "Revised";
    tasks[0].done = false;
    if (removeTask) tasks.length = 0;
    heads.frontend = BASE;
    const recovered = await tracker.complete(input);
    assert.equal(recovered.changed, false);
    assert.deepEqual(recovered.attempt, completed.attempt);
    const status = await tracker.status(input.changeId);
    assert.deepEqual(status.active, []);
    assert.deepEqual(status.completed, [completed.attempt]);
  }
});
