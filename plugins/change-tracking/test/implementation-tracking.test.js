import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { ImplementationTrackingService } from "../lib/implementation-service.js";
import { ImplementationMapRepository } from "../lib/implementation-map-repository.js";
import { assignmentContext } from "./assignment-context.js";

const sha = "b".repeat(40);
const input = { change_id: "checkout-flow", task_id: "1", task_description: "Implement",
  pull_request: "https://example.test/pr/42", commits: [sha], summary: "API done; unit tests pass",
  remaining: "Add integration tests", expected_version: 0 };
/** Изолированный контекст без чтения HEAD и без чистого Store. */
function fixture() {
  const tasks = [{ id: "1", description: "Implement", done: false }];
  const original = assignmentContext({ invocation: { id: "frontend", role: "code" }, tasks,
    planningChangedPaths: ["tasks.md"], repositoryChangedPaths: ["unrelated.txt"] });
  const context = { ...original, repositories: { async git(id) {
    assert.equal(id, "frontend");
    return { async hasCommit(value) { return value === sha; },
      revision() { throw new Error("must not infer HEAD"); } };
  } } };
  return { tasks, context, service: new ImplementationTrackingService(context) };
}

test("partial PR survives handoff using only the Change file and follows live checkboxes", async () => {
  const { context, service, tasks } = fixture();
  const result = await service.record(input);
  assert.equal(result.task_done, false);
  assert.equal(await context.storage.read(), null);
  const source = await context.files.read(result.path);
  assert.equal(parse(source).contract_version, 1);
  assert.equal(parse(source).implementations[0].plan_url, input.pull_request);
  const receiver = assignmentContext({ tasks });
  await receiver.files.write(result.path, source);
  const next = new ImplementationTrackingService(receiver);
  let [entry] = await next.status(input.change_id);
  assert.equal(entry.task_state, "open");
  assert.equal(entry.remaining, input.remaining);
  tasks[0].done = true;
  assert.equal((await next.status(input.change_id))[0].task_done, true);
  tasks[0].done = false;
  assert.equal((await next.status(input.change_id))[0].task_done, false);
  tasks[0].description = "Different task";
  assert.equal((await next.status(input.change_id))[0].task_state, "changed_or_missing");
  assert.equal(await receiver.files.read(result.path), source, "status must not write");
  assert.equal(await receiver.storage.read(), null);
});

test("retry is idempotent and stale updates cannot overwrite another contributor", async () => {
  const { service, context } = fixture();
  await service.record(input);
  assert.equal((await service.record(input)).changed, false);
  const update = { ...input, expected_version: 1, summary: "Tests added", remaining: "" };
  const result = await service.record(update);
  assert.equal(result.implementation.version, 2);
  await assert.rejects(service.record({ ...update, summary: "Stale writer" }), /IMPLEMENTATION_CONFLICT/);
  assert.equal((await service.record(update)).changed, false);
  assert.equal((await service.status(input.change_id))[0].summary, "Tests added");
  assert.equal(await context.storage.read(), null);
});

test("validation rejects wrong task, unsafe links, unknown SHA and unknown properties before writing", async () => {
  const { service, context } = fixture();
  for (const extra of [{ task_description: "Other" }, { task_id: "1.1" },
    { pull_request: "file:///tmp/a" }, { commits: ["c".repeat(40)] },
    { commits: ["HEAD"] }, { expected_version: -1 }, { unexpected: true }]) {
    await assert.rejects(service.record({ ...input, ...extra }));
  }
  assert.equal(await context.files.read("openspec/changes/checkout-flow/implementation-map.yaml", { optional: true }), null);
});

test("first handoff preserves completed attempts in the same initial map format", async () => {
  const { service, context } = fixture();
  const maps = new ImplementationMapRepository(context.files);
  const old = { repository_id: "frontend", task: { id: "old", description: "Previous" },
    schema_name: "spec-driven", planning_revision: sha, base_revision: sha, implementation_revision: sha,
    started_at: "2026-09-09T10:00:00Z", completed_at: "2026-09-09T10:00:01Z" };
  await maps.append(input.change_id, old);
  assert.equal(parse(await context.files.read(maps.pathFor(input.change_id))).contract_version, 1);
  assert.deepEqual(parse(await context.files.read(maps.pathFor(input.change_id))).implementations, []);
  assert.deepEqual(await service.status(input.change_id), []);
  assert.equal(parse(await context.files.read(maps.pathFor(input.change_id))).contract_version, 1);
  const local = { contract_version: 2, active_attempts: [], cancelled_attempts: [] };
  await context.storage.update(() => local);
  await service.record(input);
  assert.deepEqual(await maps.read(input.change_id), [old]);
  assert.deepEqual(await context.storage.read(), local);
  const source = await context.files.read(maps.pathFor(input.change_id));
  await assert.rejects(service.record({ ...input, expected_version: 1, task_description: "Renumbered" }), /IMPLEMENTATION_TASK_CHANGED/);
  assert.equal(await context.files.read(maps.pathFor(input.change_id)), source);
});

test("PR fragments cannot create a second identity or bypass version checks", async () => {
  const { service } = fixture();
  await service.record(input);
  const fragment = { ...input, pull_request: `${input.pull_request}#discussion` };
  await assert.rejects(service.record(fragment), /IMPLEMENTATION_CONFLICT/);
  const result = await service.record({ ...fragment, expected_version: 1 });
  assert.equal(result.implementation.pull_request, input.pull_request);
  assert.equal(result.implementation.plan_url, fragment.pull_request);
  assert.equal((await service.status(input.change_id)).length, 1);
  assert.equal((await service.record({ ...fragment, expected_version: 1 })).changed, false);
});

test("new overview survives corrupted legacy storage without hiding or deleting it", async () => {
  const { context, service, tasks } = fixture();
  const { ChangeTrackingApplication } = await import("../lib/application.js");
  await service.record(input);
  const corrupted = { broken: true };
  await context.storage.update(() => corrupted);
  tasks.push({ id: "2", description: "Untracked", done: false });
  const source = await context.files.read("openspec/changes/checkout-flow/implementation-map.yaml");
  const status = await new ChangeTrackingApplication(context).getStatus(input.change_id);
  assert.equal(status.implementations.length, 1);
  assert.equal(status.tasks.length, 2);
  assert.equal(status.legacy_error.code, "PLUGIN_STORAGE_CORRUPTED");
  assert.equal(status.active, null);
  assert.equal(status.cancelled, null);
  assert.deepEqual(await context.storage.read(), corrupted);
  assert.equal(await context.files.read(status.path), source);
  const failed = new ChangeTrackingApplication(context, { service: { async status() { throw new Error("EACCES"); } } });
  await assert.rejects(failed.getStatus(input.change_id), /EACCES/);
});

test("explicit rebind handles changed descriptions and IDs with conflict protection", async () => {
  const { service, tasks } = fixture();
  await service.record(input);
  tasks[0].description = "Implement safely";
  const renamed = { ...input, task_description: tasks[0].description, expected_version: 1 };
  await assert.rejects(service.record(renamed), /IMPLEMENTATION_TASK_CHANGED/);
  const result = await service.record({ ...renamed, previous_task_id: "1" });
  assert.equal(result.implementation.version, 2);
  tasks[0].id = "new-id";
  const rebound = { ...renamed, task_id: "new-id", previous_task_id: "1", expected_version: 2 };
  await service.record(rebound);
  assert.equal((await service.record(rebound)).changed, false);
  const [entry] = await service.status(input.change_id);
  assert.equal(entry.task.id, "new-id");
  assert.equal(entry.task_state, "open");
  assert.deepEqual(entry.commits, input.commits);
  await assert.rejects(service.record({ ...rebound, expected_version: 3, summary: "Stale source" }), /IMPLEMENTATION_REBIND_MISSING/);
  tasks.push({ id: "2", description: "Other task", done: false });
  await service.record({ ...input, task_id: "2", task_description: "Other task" });
  await assert.rejects(service.record({ ...input, task_id: "2", task_description: "Other task",
    previous_task_id: "new-id", expected_version: 3 }), /IMPLEMENTATION_CONFLICT/);
  assert.equal((await service.status(input.change_id)).length, 2);
});

test("overview includes untracked tasks and reports contradictions without writing checkboxes", async () => {
  const { service, context, tasks } = fixture();
  tasks.push({ id: "2", description: "No PR", done: true });
  let overview = await service.overview(input.change_id);
  assert.equal(overview.tasks.length, 2);
  assert.deepEqual(overview.tasks[0].implementations, []);
  assert.deepEqual(overview.tasks[1].warnings, ["DONE_WITHOUT_IMPLEMENTATION"]);
  await service.record({ ...input, commits: [] });
  tasks[0].done = true;
  const source = await context.files.read("openspec/changes/checkout-flow/implementation-map.yaml");
  overview = await service.overview(input.change_id);
  assert.equal(overview.tasks[0].done, true);
  assert.deepEqual(overview.tasks[0].warnings, ["DONE_WITH_REMAINING_WORK", "DONE_WITHOUT_COMMITS"]);
  tasks[0].done = false;
  overview = await service.overview(input.change_id);
  assert.deepEqual(overview.tasks[0].warnings, []);
  assert.equal(await context.files.read("openspec/changes/checkout-flow/implementation-map.yaml"), source);
});


test("unsupported map formats are rejected without rewriting the file", async () => {
  const { context, service } = fixture();
  const maps = new ImplementationMapRepository(context.files);
  const path = maps.pathFor(input.change_id);
  for (const document of [
    { contract_version: 2, change_id: input.change_id, attempts: [], implementations: [] },
    { contract_version: "1", change_id: input.change_id, attempts: [], implementations: [] },
    { contract_version: 1, change_id: input.change_id, attempts: [] },
  ]) {
    const source = JSON.stringify(document);
    await context.files.write(path, source);
    await assert.rejects(service.status(input.change_id), /STATE_CORRUPTED/);
    await assert.rejects(service.record(input), /STATE_CORRUPTED/);
    assert.equal(await context.files.read(path), source);
  }
});
