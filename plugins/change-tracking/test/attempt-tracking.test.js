/** @fileoverview Narrow task-to-revision attempt flow for Change Tracking. */

import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";

import { AttemptTrackingService } from "../lib/attempt-service.js";
import { ImplementationMapRepository } from "../lib/implementation-map-repository.js";
import { assignmentContext } from "./assignment-context.js";

const BASE = "a".repeat(40);
const IMPLEMENTATION = "b".repeat(40);

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
    completed: manifest.attempts,
  });
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
