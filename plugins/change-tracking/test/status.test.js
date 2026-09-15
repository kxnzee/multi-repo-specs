/** @fileoverview Пользовательский отчёт объединяет read-only OpenSpec progress и Tracking. */
import assert from "node:assert/strict";
import test from "node:test";
import { assignmentContext } from "../fixtures/assignment-context.js";
import { ChangeTrackingApplication } from "../lib/application.js";
import { compactStatus, formatStatus } from "../lib/presentation.js";

const input = { change_id: "checkout-flow", task_id: "1" };
const mapPath = "openspec/changes/checkout-flow/implementation-map.yaml";

/** Состояние Git изменяется явно; каждое чтение должно видеть новые факты. */
function fixture(options = {}) {
  const heads = { frontend: "a".repeat(40) };
  const dirty = [];
  const context = assignmentContext({ implementationHeads: heads, repositoryChangedPaths: dirty,
    invocation: { id: "frontend", role: "code", path: "/workspace/receiver" }, ...options });
  return { context, heads, dirty, app: new ChangeTrackingApplication(context) };
}

test("summary reads checkbox progress and counts revisions independently", async () => {
  const tasks = [
    { id: "1", description: "1.1 Implement checkout flow", done: false },
    { id: "2", description: "1.2 Verify checkout fallback", done: false },
  ];
  const { app, context } = fixture({ tasks });
  const backendContext = assignmentContext({ invocation: { id: "backend", role: "code" } });
  const backend = new ChangeTrackingApplication({ ...backendContext, files: context.files });
  await app.start(input);
  await backend.start(input);
  await backend.checkpoint(input);
  await app.complete(input);
  assert.deepEqual((await app.getStatus(input.change_id)).summary,
    { total_tasks: 2, completed_tasks: 0, remaining_tasks: 2,
      tasks_with_revision: 1, tasks_without_revision: 1, active_records: 0 });
  tasks[0].done = true;
  assert.deepEqual((await app.getStatus(input.change_id)).summary,
    { total_tasks: 2, completed_tasks: 1, remaining_tasks: 1,
      tasks_with_revision: 1, tasks_without_revision: 1, active_records: 0 });
});

test("fresh read distinguishes dirty work and later commits without workflow reads or writes", async () => {
  const { app, context, heads, dirty } = fixture();
  await app.start(input);
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
  assert.match(formatStatus(await app.getStatus(input.change_id)), /! \[ \] 1: 1\.1 Implement checkout flow \(frontend\)/u);
  assert.equal(await context.files.read(mapPath), source);
  assert.deepEqual(await context.storage.read(), local);
});

test("status preserves revisions when the read-only OpenSpec API is unavailable", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const independent = new ChangeTrackingApplication({ ...context,
    process: Object.freeze({ async run() { throw new Error("workflow unavailable"); } }) });
  const report = await independent.getStatus(input.change_id);
  assert.deepEqual(report.summary,
    { total_tasks: null, completed_tasks: null, remaining_tasks: null,
      tasks_with_revision: 1, tasks_without_revision: null, active_records: 1 });
  assert.equal(report.tasks[0].revision_recorded, true);
  assert.equal(report.tasks[0].task_done, null);
  assert.equal(report.tasks[0].local_work, "active");
  const compact = compactStatus(report);
  assert.equal(compact.tasks[0].implementation_revision, undefined);
  assert.equal(JSON.stringify(compact).includes("workflow unavailable"), false);
  assert.equal(report.tasks[0].implementation_revision, "a".repeat(40));
});

test("focus shows OpenSpec tasks without revisions and rejects an unknown task", async () => {
  const { app } = fixture();
  const untracked = await app.getStatus(input.change_id, { task_id: "2" });
  assert.equal(untracked.tasks[0].revision_recorded, false);
  await assert.rejects(app.getStatus(input.change_id, { task_id: "3" }), /TRACKING_RECORD_MISSING/);
  await app.start(input);
  const focused = await app.getStatus(input.change_id, { task_id: "1" });
  assert.equal(focused.tasks.length, 1);
  assert.equal(focused.tasks[0].task_id, "1");
  assert.equal(focused.tasks[0].repository_id, "frontend");
  assert.match(formatStatus(focused), /• \[ \] 1: 1\.1 Implement checkout flow \(frontend\)/u);
});

test("missing Git and corrupt local state preserve readable records but never suggest immediate completion", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint({ ...input, note: "UI remains" });
  const missing = new ChangeTrackingApplication({ ...context,
    repositories: { async git() { throw new Error("REPO_UNAVAILABLE"); } } });
  const row = (await missing.getStatus(input.change_id)).tasks[0];
  assert.equal(row.checkout, "unavailable");
  assert.equal(row.revision_recorded, true);
  assert.equal(row.needs_attention, true);
  assert.equal(row.next_step.includes("complete"), false);
  await context.storage.update(() => ({ broken: true }));
  const corrupt = await app.getStatus(input.change_id);
  assert.equal(corrupt.warnings[0].code, "LOCAL_STATE_UNAVAILABLE");
  assert.equal(corrupt.tasks[0].message, "Revision записана.");
  assert.equal(corrupt.tasks[0].needs_attention, false);
  assert.equal(corrupt.tasks[0].next_step, null);
  assert.equal(corrupt.tasks[1].message, "Revision пока не записана.");
  assert.equal(corrupt.tasks[1].next_step, null);
  const formatted = formatStatus(corrupt);
  assert.doesNotMatch(formatted, /Локальное состояние работы неизвестно/u);
  assert.equal(formatted.match(/Локальное состояние Tracking недоступно/gu)?.length, 1);
});

test("handoff focus retains note and detects another writer before a write attempt", async () => {
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
