/** @fileoverview Пользовательский отчёт выводит только наблюдаемые факты без записи состояния. */
import assert from "node:assert/strict";
import test from "node:test";
import { assignmentContext } from "../fixtures/assignment-context.js";
import { ChangeTrackingApplication } from "../lib/application.js";
import { compactStatus, formatStatus } from "../lib/presentation.js";

const input = { change_id: "checkout-flow", task_id: "1" };
const mapPath = "openspec/changes/checkout-flow/implementation-map.yaml";

/** Состояние источников изменяется явно; каждое чтение должно видеть новые факты. */
function fixture() {
  const tasks = [{ id: "1", description: "Display region", done: false }, { id: "2", description: "Review", done: false }];
  const heads = { frontend: "a".repeat(40) };
  const dirty = [];
  const context = assignmentContext({ tasks, implementationHeads: heads, repositoryChangedPaths: dirty,
    invocation: { id: "frontend", role: "code", path: "/workspace/receiver" } });
  return { context, tasks, heads, dirty, app: new ChangeTrackingApplication(context) };
}

test("summary counts a task once across repositories and separates checkbox from recorded completion", async () => {
  const { app, context, tasks } = fixture();
  const backendContext = assignmentContext({ tasks, invocation: { id: "backend", role: "code" } });
  const backend = new ChangeTrackingApplication({ ...backendContext, files: context.files });
  await app.start(input);
  await backend.start(input);
  await backend.checkpoint(input);
  tasks[0].done = true;
  await app.complete(input);
  const partial = await app.getStatus(input.change_id);
  assert.deepEqual(partial.summary, { total_tasks: 2, completed_tasks: 1, recorded_tasks: 0 });
  assert.equal(partial.tasks.find(({ repository_id }) => repository_id === "backend").needs_attention, true);
  await backend.complete(input);
  assert.deepEqual((await app.getStatus(input.change_id)).summary, { total_tasks: 2, completed_tasks: 1, recorded_tasks: 1 });
});

test("fresh read distinguishes dirty work, later commits, reopened task and changed plan without writes", async () => {
  const { app, context, tasks, heads, dirty } = fixture();
  await app.start(input);
  tasks[0].done = true;
  assert.equal((await app.getStatus(input.change_id)).tasks[0].needs_attention, true);
  await app.complete(input);
  const source = await context.files.read(mapPath);
  const local = JSON.parse(JSON.stringify(await context.storage.read()));
  heads.frontend = "b".repeat(40);
  const ahead = (await app.getStatus(input.change_id)).tasks[0];
  assert.equal(ahead.checkout, "ahead");
  assert.equal(ahead.needs_attention, false);
  dirty.push("field.js");
  const changed = (await app.getStatus(input.change_id)).tasks[0];
  assert.equal(changed.checkout, "dirty");
  assert.equal(changed.needs_attention, true);
  dirty.length = 0;
  tasks[0].done = false;
  const reopened = (await app.getStatus(input.change_id)).tasks[0];
  assert.equal(reopened.state, "complete");
  assert.equal(reopened.task_done, false);
  assert.equal(reopened.needs_attention, true);
  tasks[0].description = "Different requirement";
  const stale = await app.getStatus(input.change_id);
  assert.equal(stale.tasks.find(({ state }) => state === "stale").description, null);
  assert.equal(stale.summary.recorded_tasks, 0);
  assert.equal(await context.files.read(mapPath), source);
  assert.deepEqual(await context.storage.read(), local);
});

test("unavailable OpenSpec stays unknown and default response hides diagnostics and revisions", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const unavailable = new ChangeTrackingApplication({ ...context,
    process: { async run() { throw new Error("EXTERNAL_PROCESS_FAILED: private diagnostic"); } } });
  const report = await unavailable.getStatus(input.change_id);
  assert.deepEqual(report.summary, { total_tasks: null, completed_tasks: null, recorded_tasks: null });
  assert.equal(report.tasks[0].state, "unknown");
  assert.equal(report.tasks[0].task_done, null);
  assert.equal(report.tasks[0].local_work, "active", "unavailable plan does not prove a local conflict");
  assert.equal(report.tasks[0].needs_attention, true);
  assert.match(report.warnings[0].details, /private diagnostic/);
  const compact = compactStatus(report);
  assert.equal(compact.candidate, undefined);
  assert.equal(compact.tasks[0].implementation_revision, undefined);
  assert.equal(compact.warnings[0].details, undefined);
  assert.equal(JSON.stringify(compact).includes("private diagnostic"), false);
  assert.equal(formatStatus(report).includes("private diagnostic"), false);
  assert.equal(report.tasks[0].implementation_revision, "a".repeat(40), "presentation does not mutate detailed evidence");
});

test("focus uses exact OpenSpec ID, resolved schema paths and current worktree without guessing assignment", async () => {
  const { app } = fixture();
  const untracked = await app.getStatus(input.change_id, { task_id: "2" });
  assert.equal(untracked.tasks[0].repository_id, null);
  assert.equal(untracked.context.checkout_path, undefined);
  await app.start(input);
  const focused = await app.getStatus(input.change_id, { task_id: "1" });
  assert.equal(focused.tasks.length, 1);
  assert.equal(focused.tasks[0].description, "Display region");
  assert.equal(focused.context.checkout_path, "/workspace/receiver");
  assert.equal(focused.context.task_file, "openspec/changes/checkout-flow/work.md");
  assert.deepEqual(focused.context.inputs, [focused.context.task_file]);
  assert.equal(focused.summary.total_tasks, 2);
  await assert.rejects(app.getStatus(input.change_id, { task_id: "1.1" }), /TRACKING_TASK_MISSING/);
});

test("missing Git and corrupt local state preserve readable records but never suggest immediate completion", async () => {
  const { app, context, tasks } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  tasks[0].done = true;
  const missing = new ChangeTrackingApplication({ ...context,
    repositories: { async git() { throw new Error("REPO_UNAVAILABLE"); } } });
  const row = (await missing.getStatus(input.change_id)).tasks[0];
  assert.equal(row.checkout, "unavailable");
  assert.equal(row.state, "partial");
  assert.equal(row.needs_attention, true);
  assert.equal(row.next_step.includes("complete"), false);
  await context.storage.update(() => ({ broken: true }));
  const corrupt = await app.getStatus(input.change_id);
  assert.equal(corrupt.warnings[0].code, "LOCAL_STATE_UNAVAILABLE");
  assert.equal(corrupt.tasks[0].next_step.includes("complete"), false);
});

test("handoff focus retains attributed note and detects another writer before a write attempt", async () => {
  const first = fixture();
  await first.app.start(input);
  await first.app.checkpoint({ ...input, note: "UI remains" });
  const second = fixture();
  const receiver = new ChangeTrackingApplication({ ...second.context, files: first.context.files });
  const before = await receiver.getStatus(input.change_id, { task_id: "1" });
  assert.equal(before.tasks[0].local_work, undefined);
  assert.equal(before.tasks[0].note, "UI remains");
  assert.match(before.tasks[0].next_step, /start/);
  await receiver.start(input);
  second.heads.frontend = "c".repeat(40);
  await receiver.checkpoint(input);
  const after = await first.app.getStatus(input.change_id);
  assert.equal(after.tasks[0].local_work, "conflict");
  assert.equal(after.tasks[0].needs_attention, true);
});
