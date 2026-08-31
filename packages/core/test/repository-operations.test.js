/** @fileoverview Проверки общего Repository selector и bounded runner. */

import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  createProject,
  RepositoryRunner,
  RepositorySelector,
} from "@openspec-orch/core";

/** Создаёт Project с Store и несколькими Code Repositories. */
function projectFixture() {
  return createProject({
    version: 2,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: [],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: [],
      },
      {
        id: "backend",
        role: "code",
        remote: "https://example.test/backend.git",
        defaultBranch: "main",
        plugins: [],
      },
    ],
  });
}

test("RepositorySelector validates IDs and roles while preserving project order", () => {
  const project = projectFixture();
  const selector = new RepositorySelector();

  assert.deepEqual(
    selector.select(project, {
      repositoryIds: ["backend", "specs", "backend"],
    }).map(({ id }) => id),
    ["specs", "backend"],
  );
  assert.deepEqual(
    selector.select(project, { roles: ["code"] }).map(({ id }) => id),
    ["frontend", "backend"],
  );
  assert.throws(
    () => selector.select(project, { repositoryIds: ["mobile"] }),
    /REPO_UNKNOWN/,
  );
  assert.throws(
    () => selector.select(project, { repositoryIds: "frontend" }),
    /repositoryIds должен быть массивом/,
  );
  assert.throws(() => selector.select(project, { roles: ["docs"] }), /неизвестная role/);
});

test("RepositoryRunner bounds concurrency and preserves result order", async () => {
  const repositories = projectFixture().repositories;
  const runner = new RepositoryRunner({ concurrency: 2 });
  let active = 0;
  let maximum = 0;

  const results = await runner.run(repositories, async (repository, index) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay((repositories.length - index) * 5);
    active -= 1;
    return repository.id;
  });

  assert.equal(runner.concurrency, 2);
  assert.equal(maximum, 2);
  assert.deepEqual(results, ["specs", "frontend", "backend"]);
  assert.equal(Object.isFrozen(results), true);
});

test("RepositoryRunner rejects invalid operations and duplicate handles", async () => {
  const repositories = projectFixture().repositories;
  const runner = new RepositoryRunner();

  await assert.rejects(runner.run(repositories, null), /operation должна быть функцией/);
  await assert.rejects(
    runner.run([repositories[0], repositories[0]], async () => null),
    /не должны повторяться/,
  );
  await assert.rejects(
    runner.run([{ id: "frontend" }], async () => null),
    /требуется Repository handle/,
  );
  assert.throws(() => new RepositoryRunner({ concurrency: 0 }), /положительным integer/);
});
