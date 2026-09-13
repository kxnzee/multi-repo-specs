/** @fileoverview Проверки реальных гарантий единого Tracking workflow. */
import assert from "node:assert/strict";
import test from "node:test";
import { parse, stringify } from "yaml";
import { assignmentContext } from "../fixtures/assignment-context.js";
import { ChangeTrackingApplication } from "../lib/application.js";

const input = { change_id: "checkout-flow", task_id: "1" };
const base = "a".repeat(40);
const next = "b".repeat(40);
const mapPath = "openspec/changes/checkout-flow/implementation-map.yaml";

/** Изменяемые задачи и HEAD принадлежат тесту, storage и files изолированы. */
function fixture(options = {}) {
  const tasks = [{ id: "1", description: "Implement", done: false }];
  const heads = { frontend: base };
  const context = assignmentContext({ tasks, implementationHeads: heads,
    invocation: { id: "frontend", role: "code" }, ...options });
  return { tasks, heads, context, app: new ChangeTrackingApplication(context) };
}

test("one workflow captures revisions, checkpoint stays open, completion and retries preserve checkboxes", async () => {
  const { app, context, tasks, heads } = fixture();
  await app.start(input);
  assert.equal(await context.files.read(mapPath, { optional: true }), null);
  heads.frontend = next;
  const partial = await app.checkpoint({ ...input, note: "UI remains" });
  assert.equal(partial.implementation.state, "partial");
  assert.equal(tasks[0].done, false);
  assert.equal((await app.checkpoint({ ...input, note: "UI remains" })).changed, false);
  await assert.rejects(app.complete(input), /TRACKING_TASK_OPEN/);
  tasks[0].done = true;
  const complete = await app.complete(input);
  assert.equal(complete.implementation.base_revision, base);
  assert.equal(complete.implementation.implementation_revision, next);
  assert.equal(complete.implementation.note, undefined);
  assert.equal((await app.complete(input)).changed, false);
  const document = parse(await context.files.read(mapPath));
  assert.deepEqual(Object.keys(document), ["contract_version", "change_id", "implementations"]);
  assert.equal(document.implementations.length, 1);
  const source = await context.files.read(mapPath);
  const status = await app.getStatus(input.change_id);
  assert.equal(status.tasks[0].checkout, "matches");
  assert.equal(status.tasks[0].state, "complete");
  tasks[0].done = false;
  assert.equal((await app.getStatus(input.change_id)).tasks[0].task_done, false);
  assert.equal(await context.files.read(mapPath), source);
  await app.start(input);
  tasks[0].done = true;
  await app.complete(input);
});

test("tasks sharing a commit and no-code tasks do not need artificial commits", async () => {
  const { app, tasks } = fixture();
  tasks.push({ id: "2", description: "Review", done: false });
  await app.start(input);
  tasks[0].done = true;
  await app.complete(input);
  const second = { ...input, task_id: "2" };
  await app.start(second);
  tasks[1].done = true;
  assert.equal((await app.complete(second)).implementation.implementation_revision, base);
});

test("reordered tasks and multiline edits cannot silently reuse positional IDs", async () => {
  const { app, context, tasks } = fixture();
  await app.start(input);
  await context.files.write("openspec/changes/checkout-flow/work.md", "- [ ] Implement\n  Changed requirement\n");
  tasks[0].done = true;
  await assert.rejects(app.complete(input), /TRACKING_PLAN_CHANGED/);
  await context.files.write("openspec/changes/checkout-flow/work.md", "- [ ] New task\n- [x] Implement\n");
  await assert.rejects(app.checkpoint(input), /TRACKING_PLAN_CHANGED/);
  assert.equal(await context.files.read(mapPath, { optional: true }), null);
});

test("handoff uses only published map and commit; independent stale contributor cannot overwrite", async () => {
  const first = fixture();
  await first.app.start(input);
  first.heads.frontend = next;
  await first.app.checkpoint({ ...input, note: "Finish UI" });
  const second = fixture();
  second.heads.frontend = next;
  const receiver = new ChangeTrackingApplication({ ...second.context, files: first.context.files });
  await receiver.start(input);
  second.heads.frontend = "c".repeat(40);
  await receiver.checkpoint(input);
  first.heads.frontend = "d".repeat(40);
  await assert.rejects(first.app.checkpoint(input), /TRACKING_CONFLICT/);
  assert.equal(parse(await first.context.files.read(mapPath)).implementations[0].implementation_revision, "c".repeat(40));
});

test("parallel contributors to different tasks preserve both entries", async () => {
  const first = fixture();
  first.tasks.push({ id: "2", description: "Second", done: false });
  const other = assignmentContext({ tasks: first.tasks, invocation: { id: "backend", role: "code" } });
  const second = new ChangeTrackingApplication({ ...other, files: first.context.files });
  await first.app.start(input);
  await second.start({ ...input, task_id: "2" });
  await Promise.all([first.app.checkpoint(input), second.checkpoint({ ...input, task_id: "2" })]);
  assert.equal(parse(await first.context.files.read(mapPath)).implementations.length, 2);
});

test("completion recovers after durable map write and interrupted local storage update", async () => {
  const { app, context, tasks } = fixture();
  await app.start(input);
  const before = await context.storage.read();
  tasks[0].done = true;
  await app.complete(input);
  await context.storage.update(() => before);
  assert.equal((await app.complete(input)).changed, false);
  assert.equal((await context.storage.read()).sessions[0].active, false);
});

test("cancel is local, preserves checkpoint and repeated completion cannot recreate cancelled work", async () => {
  const { app, context, tasks } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const before = await context.files.read(mapPath);
  await app.cancel({ ...input, reason: "Handed over" });
  tasks[0].done = true;
  await assert.rejects(app.complete(input), /TRACKING_NOT_STARTED/);
  assert.equal(await context.files.read(mapPath), before);
});

test("missing commit, wrong checkout, dirty tree and unrelated history fail closed", async () => {
  const { app, context, heads } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  await app.cancel({ ...input, reason: "Hand off" });
  heads.frontend = next;
  await assert.rejects(app.start(input), /TRACKING_CHECKOUT_MISMATCH/);
  const missing = new ChangeTrackingApplication({ ...context, repositories: { async git(id) {
    return { ...await context.repositories.git(id), async hasCommit() { return false; } };
  } } });
  await assert.rejects(missing.start(input), /TRACKING_COMMIT_MISSING/);
  const dirty = fixture({ repositoryChangedPaths: ["unrelated.js"] });
  await assert.rejects(dirty.app.start(input), /TRACKING_WORKTREE_DIRTY/);
  const unrelated = fixture({ ancestor: false });
  await unrelated.app.start(input);
  await assert.rejects(unrelated.app.checkpoint(input), /TRACKING_HISTORY_CHANGED/);
});

test("explicit restart acknowledges changed planning but does not bypass later conflicts", async () => {
  const { app, tasks } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  tasks[0].description = "Revised task";
  await assert.rejects(app.start(input), /TRACKING_PLAN_CHANGED/);
  await app.start({ ...input, restart: true });
  tasks[0].done = true;
  assert.equal((await app.complete(input)).implementation.state, "complete");
});

test("map corruption is preserved and corrupt local storage does not hide a readable checkpoint", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  await context.storage.update(() => ({ broken: true }));
  const status = await app.getStatus(input.change_id);
  assert.equal(status.tasks[0].state, "partial");
  assert.equal(status.warnings[0].code, "LOCAL_STATE_UNAVAILABLE");
  const old = stringify({ contract_version: 1, change_id: input.change_id, implementations: [], attempts: [] });
  await context.files.write(mapPath, old);
  await assert.rejects(app.getStatus(input.change_id), /TRACKING_MAP_INVALID/);
  assert.equal(await context.files.read(mapPath), old);
});

test("candidate changes with checkout revisions without rewriting recorded implementation", async () => {
  const { app, context, heads } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const before = await app.getStatus(input.change_id);
  const source = await context.files.read(mapPath);
  heads.frontend = next;
  const after = await app.getStatus(input.change_id);
  assert.notEqual(after.candidate.id, before.candidate.id);
  assert.equal(after.tasks[0].checkout, "ahead");
  assert.equal(before.candidate.repositories[0].revision, base);
  assert.equal(await context.files.read(mapPath), source);
});

test("candidate identity includes planning inputs but ignores task checkboxes", async () => {
  const { app, tasks } = fixture();
  await app.start(input);
  const before = await app.getStatus(input.change_id);
  tasks[0].done = true;
  assert.equal((await app.getStatus(input.change_id)).candidate.id, before.candidate.id);
  tasks[0].description = "Changed acceptance criteria";
  assert.notEqual((await app.getStatus(input.change_id)).candidate.id, before.candidate.id);
});
