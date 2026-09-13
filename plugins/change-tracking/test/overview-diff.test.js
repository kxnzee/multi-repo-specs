/** @fileoverview Обзор и сравнение используют живые источники и не расширяют persisted map. */
import assert from "node:assert/strict";
import test from "node:test";
import { assignmentContext } from "../fixtures/assignment-context.js";
import { ChangeTrackingApplication } from "../lib/application.js";
import { compactStatus, formatStatus } from "../lib/presentation.js";
import { formatOverview } from "../lib/overview.js";

const input = { change_id: "checkout-flow", task_id: "1" };
const mapPath = "openspec/changes/checkout-flow/implementation-map.yaml";

test("overview follows only the live OpenSpec list, isolates broken maps and retains actionable facts", async () => {
  const changes = ["z-other", "checkout-flow", "broken"];
  const tasks = [{ id: "1", description: "Field", done: false }];
  const context = assignmentContext({ changes, tasks, invocation: { id: "frontend", role: "code" } });
  const app = new ChangeTrackingApplication(context);
  await app.start(input);
  await app.checkpoint(input);
  await context.files.write("openspec/changes/broken/implementation-map.yaml", "broken");
  await context.files.write("openspec/changes/not-listed/implementation-map.yaml", "broken");
  const map = await context.files.read(mapPath);
  const local = JSON.stringify(await context.storage.read());
  const report = await app.getStatus(undefined, { all: true });
  assert.deepEqual(report.changes.map(({ change_id }) => change_id), ["broken", "checkout-flow", "z-other"]);
  assert.equal(report.changes[0].summary.total_tasks, null);
  assert.equal(report.changes[0].checkpoints, null, "unreadable data does not mean no checkpoints");
  assert.equal(report.changes[0].warnings[0].code, "TRACKING_STATUS_UNAVAILABLE");
  assert.deepEqual(report.changes[1].checkpoints, [{ task_id: "1", repository_id: "frontend" }]);
  assert.equal(report.changes[1].summary.completed_tasks, 0);
  assert.equal(report.changes[2].summary.total_tasks, 1);
  tasks[0].done = true;
  const next = await app.getStatus(undefined, { all: true });
  assert.equal(next.changes[1].summary.completed_tasks, 1);
  assert.equal(next.changes[1].summary.recorded_tasks, 0);
  assert.equal(next.changes[1].attention[0].task_id, "1");
  assert.equal(next.changes[1].attention[0].next_step.length > 0, true);
  assert.equal(JSON.stringify(next).includes("a".repeat(40)), false);
  assert.equal(formatOverview(next).split("\n").length, 3);
  assert.equal(await context.files.read(mapPath), map);
  assert.equal(JSON.stringify(await context.storage.read()), local);
  changes.length = 0;
  assert.deepEqual(await app.getStatus(undefined, { all: true }), { changes: [] });
});

test("unavailable or incompatible OpenSpec list cannot become a successful empty overview", async () => {
  const context = assignmentContext();
  for (const output of ["not json", "{}", '{"changes":[{"name":"../outside"}]}',
    '{"changes":[{"name":"same"},{"name":"same"}]}']) {
    const app = new ChangeTrackingApplication({ ...context, process: { async run(executable, args) {
      return args[0] === "list" ? output : context.process.run(executable, args);
    } } });
    await assert.rejects(app.getStatus(undefined, { all: true }), /OPENSPEC_STATUS_INVALID/);
  }
  const unavailable = new ChangeTrackingApplication({ ...context, process: { async run() { throw new Error("offline"); } } });
  await assert.rejects(unavailable.getStatus(undefined, { all: true }), /offline/);
});

test("invalid status combinations fail before any source is read", async () => {
  const app = new ChangeTrackingApplication({ files: {} });
  for (const [id, options] of [[undefined, {}], [input.change_id, { all: true }],
    [undefined, { all: true, task_id: "1" }], [undefined, { all: true, diff: true }],
    [input.change_id, { diff: true }], [input.change_id, { diff: "yes", task_id: "1" }]]) {
    await assert.rejects(app.getStatus(id, options), /TRACKING_INPUT_INVALID/);
  }
});

test("diff is opt-in, uses the last saved revision and does not invent a baseline before checkpoint", async () => {
  const heads = { frontend: "a".repeat(40) };
  const dirty = [];
  const original = assignmentContext({ implementationHeads: heads, repositoryChangedPaths: dirty,
    invocation: { id: "frontend", role: "code" } });
  let reads = 0;
  let changedHead = false;
  const context = { ...original, repositories: { async git(id) {
    return { ...await original.repositories.git(id), async changesSince(from) {
      reads++;
      assert.equal(from, "b".repeat(40));
      return { from_revision: from, to_revision: changedHead ? "d".repeat(40) : heads.frontend, commit_count: 1,
        committed_files: ["field.js"], worktree_files: ["draft.txt"] };
    } };
  } } };
  const app = new ChangeTrackingApplication(context);
  await app.start(input);
  const unsaved = await app.getStatus(input.change_id, { task_id: "1", diff: true });
  assert.equal(unsaved.tasks[0].diff.available, false);
  assert.equal(reads, 0);
  heads.frontend = "b".repeat(40);
  await app.checkpoint(input);
  const source = await context.files.read(mapPath);
  heads.frontend = "c".repeat(40);
  dirty.push("draft.txt");
  assert.equal((await app.getStatus(input.change_id)).tasks[0].diff, undefined);
  assert.equal(reads, 0);
  const report = await app.getStatus(input.change_id, { task_id: "1", diff: true });
  assert.equal(report.tasks[0].diff.available, true);
  assert.equal(report.tasks[0].diff.commit_count, 1);
  const short = compactStatus(report);
  assert.equal(short.tasks[0].diff.from_revision, undefined);
  assert.equal(short.tasks[0].diff.to_revision, undefined);
  assert.deepEqual(short.tasks[0].diff.worktree_files, ["draft.txt"]);
  assert.equal(formatStatus(report).includes("b".repeat(40)), false);
  assert.equal(await context.files.read(mapPath), source);
  changedHead = true;
  const raced = await app.getStatus(input.change_id, { task_id: "1", diff: true });
  assert.equal(raced.tasks[0].diff.available, false);
  assert.match(raced.tasks[0].diff.details, /TRACKING_CHECKOUT_CHANGED/);
});

test("failed comparison preserves the task report without claiming zero changes", async () => {
  const context = assignmentContext({ invocation: { id: "frontend", role: "code" } });
  const app = new ChangeTrackingApplication(context);
  await app.start(input);
  await app.checkpoint(input);
  const unavailable = new ChangeTrackingApplication({ ...context, repositories: { async git(id) {
    return { ...await context.repositories.git(id), async changesSince() { throw new Error("GIT_HISTORY_DIVERGED"); } };
  } } });
  const report = await unavailable.getStatus(input.change_id, { task_id: "1", diff: true });
  assert.equal(report.tasks[0].state, "partial");
  assert.equal(report.tasks[0].diff.available, false);
  assert.equal(report.tasks[0].diff.commit_count, undefined);
  assert.equal(compactStatus(report).tasks[0].diff.details, undefined);
});
