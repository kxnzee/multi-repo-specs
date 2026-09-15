/** @fileoverview Проверки гарантий независимого Change Tracking workflow. */
import assert from "node:assert/strict";
import test from "node:test";
import { parse, stringify } from "yaml";
import { assignmentContext } from "../fixtures/assignment-context.js";
import { ChangeTrackingApplication } from "../lib/application.js";

const input = { change_id: "checkout-flow", task_id: "1" };
const base = "a".repeat(40);
const next = "b".repeat(40);
const mapPath = "openspec/changes/checkout-flow/implementation-map.yaml";

/** Изменяемые HEAD принадлежат тесту, storage и files изолированы. */
function fixture(options = {}) {
  const heads = { frontend: base };
  const context = assignmentContext({ implementationHeads: heads,
    invocation: { id: "frontend", role: "code" }, ...options });
  return { heads, context, app: new ChangeTrackingApplication(context) };
}

test("checkpoint and complete never recreate an inactive Change", async () => {
  for (const operation of ["checkpoint", "complete"]) {
    for (const saved of [false, true]) {
      const changes = [input.change_id];
      const { app, context } = fixture({ changes });
      await app.start(input);
      if (saved) await app.checkpoint(input);
      const before = await context.files.read(mapPath, { optional: true });
      changes.length = 0;
      await assert.rejects(app[operation](input), /TRACKING_CHANGE_MISSING/u);
      assert.equal(await context.files.read(mapPath, { optional: true }), before);
      changes.push(input.change_id);
      await app[operation](input);
    }
  }
});

test("one workflow records revisions without persisting a second completion state", async () => {
  const { app, context, heads } = fixture();
  await app.start(input);
  assert.equal(await context.files.read(mapPath, { optional: true }), null);
  heads.frontend = next;
  const partial = await app.checkpoint({ ...input, note: "UI remains" });
  assert.equal(partial.implementation.note, "UI remains");
  assert.equal((await app.checkpoint({ ...input, note: "UI remains" })).changed, false);
  const complete = await app.complete(input);
  assert.equal(complete.implementation.base_revision, base);
  assert.equal(complete.implementation.implementation_revision, next);
  assert.equal(complete.implementation.note, undefined);
  assert.equal((await app.complete(input)).changed, false);
  const document = parse(await context.files.read(mapPath));
  assert.deepEqual(Object.keys(document), ["contract_version", "change_id", "implementations"]);
  assert.equal(document.implementations.length, 1);
  assert.deepEqual(Object.keys(document.implementations[0]), ["repository_id", "task_id",
    "store_revision", "base_revision", "implementation_revision"]);
  const status = await app.getStatus(input.change_id);
  assert.equal(status.tasks[0].revision_recorded, true);
  assert.equal(status.tasks[0].task_done, false);
});

test("task_id is opaque and write operations never read workflow task progress", async () => {
  const original = assignmentContext({ invocation: { id: "frontend", role: "code" } });
  const calls = [];
  const context = { ...original, process: Object.freeze({ async run(executable, args) {
    calls.push([executable, ...args]);
    if (args[0] === "instructions") throw new Error("workflow API must not be called");
    return original.process.run(executable, args);
  } }) };
  const app = new ChangeTrackingApplication(context);
  const arbitrary = { change_id: "checkout-flow", task_id: "repository-slice" };
  await app.start(arbitrary);
  await app.complete(arbitrary);
  assert.equal(calls.some((call) => call.includes("instructions")), false);
});

test("tasks sharing a commit and no-code tasks do not need artificial commits", async () => {
  const { app } = fixture();
  await app.start(input);
  await app.complete(input);
  const second = { ...input, task_id: "2" };
  await app.start(second);
  assert.equal((await app.complete(second)).implementation.implementation_revision, base);
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
  const other = assignmentContext({ invocation: { id: "backend", role: "code" } });
  const second = new ChangeTrackingApplication({ ...other, files: first.context.files });
  await first.app.start(input);
  await second.start({ ...input, task_id: "2" });
  await Promise.all([first.app.checkpoint(input), second.checkpoint({ ...input, task_id: "2" })]);
  assert.equal(parse(await first.context.files.read(mapPath)).implementations.length, 2);
});

test("completion recovers after durable map write and interrupted local storage update", async () => {
  const { app, context } = fixture();
  await app.start(input);
  const before = await context.storage.read();
  await app.complete(input);
  await context.storage.update(() => before);
  assert.equal((await app.complete(input)).changed, false);
  assert.equal((await context.storage.read()).sessions[0].active, false);
});

test("cancel is local, preserves checkpoint and repeated completion cannot recreate cancelled work", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const before = await context.files.read(mapPath);
  await app.cancel({ ...input, reason: "Handed over" });
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

test("restart preserves the original comparison point without consulting workflow state", async () => {
  const { app, heads } = fixture();
  await app.start(input);
  heads.frontend = next;
  await app.checkpoint(input);
  const restarted = await app.start({ ...input, restart: true });
  assert.equal(restarted.base_revision, base);
  assert.equal((await app.complete(input)).implementation.base_revision, base);
});

test("restart rejects missing saved commits and divergent history", async () => {
  const { app, context, heads } = fixture();
  await app.start(input);
  heads.frontend = next;
  await app.checkpoint(input);
  const missing = new ChangeTrackingApplication({ ...context, repositories: { async git(id) {
    return { ...await context.repositories.git(id), async hasCommit(revision) { return revision !== next; } };
  } } });
  await assert.rejects(missing.start({ ...input, restart: true }), /TRACKING_COMMIT_MISSING/);
  const divergent = new ChangeTrackingApplication({ ...context, repositories: { async git(id) {
    return { ...await context.repositories.git(id), async isAncestor() { return false; } };
  } } });
  await assert.rejects(divergent.start({ ...input, restart: true }), /TRACKING_HISTORY_CHANGED/);
});

test("map corruption is preserved and corrupt local storage does not hide a readable checkpoint", async () => {
  const { app, context } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  await context.storage.update(() => ({ broken: true }));
  const status = await app.getStatus(input.change_id);
  assert.equal(status.tasks[0].revision_recorded, true);
  assert.equal(status.tasks[0].task_done, false);
  assert.equal(status.warnings[0].code, "LOCAL_STATE_UNAVAILABLE");
  const old = stringify({ contract_version: 1, change_id: input.change_id, implementations: [], attempts: [] });
  await context.files.write(mapPath, old);
  await assert.rejects(app.getStatus(input.change_id), /TRACKING_MAP_INVALID/);
  assert.equal(await context.files.read(mapPath), old);
});

test("status follows checkout revisions without rewriting recorded implementation", async () => {
  const { app, context, heads } = fixture();
  await app.start(input);
  await app.checkpoint(input);
  const source = await context.files.read(mapPath);
  heads.frontend = next;
  assert.equal((await app.getStatus(input.change_id)).tasks[0].checkout, "ahead");
  assert.equal(await context.files.read(mapPath), source);
});
