/** @fileoverview Characterization нового Core domain относительно legacy ProjectModel. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createProject,
  createRepository,
  createStore,
  Project,
  Repository,
  Store,
} from "@openspec-orch/core";

/** Возвращает нормализованный Project config для characterization. */
function projectConfig() {
  const repositories = [
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
  ];
  return {
    version: 2,
    strict: true,
    agents: ["codex"],
    plugins: [],
    extensions: {},
    repositories,
    storeRepository: repositories[0],
    codeRepositories: repositories.slice(1),
  };
}

test("Core exports Repository as an immutable domain entity", () => {
  const repository = createRepository(projectConfig().repositories[1]);

  assert.equal(repository instanceof Repository, true);
  assert.equal(repository.isCode(), true);
  assert.equal(repository.isStore(), false);
  assert.equal(Object.isFrozen(repository), true);
  assert.equal(Object.isFrozen(repository.plugins), true);

  const connected = repository.connectPlugin("dependency-audit");
  assert.notEqual(connected, repository);
  assert.equal(repository.hasPlugin("dependency-audit"), false);
  assert.equal(connected.hasPlugin("dependency-audit"), true);
  assert.equal(connected.disconnectPlugin("dependency-audit").hasPlugin("dependency-audit"), false);
});

test("Store owns metadata identity and matches the Store Repository", () => {
  const config = projectConfig();
  const store = createStore({ id: "specs", remote: "git@example.test:specs.git" });
  const repository = createRepository(config.repositories[0]);
  const sameRemote = (left, right) => left.includes("specs.git") && right.includes("specs.git");

  assert.equal(store instanceof Store, true);
  assert.equal(store.matches(repository, sameRemote), true);
  assert.doesNotThrow(() => store.assertMatches(repository, sameRemote));
  assert.throws(
    () => store.assertMatches(createRepository(config.repositories[1]), sameRemote),
    /STORE_IDENTITY_MISMATCH/,
  );
});

test("Project preserves registry and Plugin binding behavior through domain methods", () => {
  const config = projectConfig();
  const project = createProject(config);

  assert.equal(project instanceof Project, true);
  assert.equal(project.storeRepository instanceof Repository, true);
  assert.deepEqual(project.codeRepositories.map(({ id }) => id), ["frontend", "backend"]);
  assert.equal(project.requireRepository("frontend").isCode(), true);
  assert.throws(() => project.requireRepository("missing"), /REPO_UNKNOWN/);

  project.registerPlugins(["dependency-audit"]);
  project.connectPlugin("dependency-audit", ["frontend", "backend"]);

  const expected = projectConfig();
  expected.plugins = ["dependency-audit"];
  expected.repositories[1].plugins = ["dependency-audit"];
  expected.repositories[2].plugins = ["dependency-audit"];
  expected.storeRepository = expected.repositories[0];
  expected.codeRepositories = expected.repositories.slice(1);
  assert.deepEqual(project.toConfig(), expected);
  assert.deepEqual(
    project.pluginConnections().map(({ pluginId, repository }) => [pluginId, repository.id]),
    [["dependency-audit", "frontend"], ["dependency-audit", "backend"]],
  );
  assert.equal(project.disconnectPlugin("dependency-audit", "frontend"), true);
  assert.equal(project.disconnectPlugin("dependency-audit", "frontend"), false);
  assert.throws(() => project.removePlugin("dependency-audit"), /PLUGIN_CONNECTED/);
  assert.equal(project.disconnectPlugin("dependency-audit", "backend"), true);
  assert.equal(project.removePlugin("dependency-audit"), true);
});

test("Project owns its config and enforces aggregate invariants", () => {
  const config = projectConfig();
  const project = createProject(config);
  config.repositories[1].plugins.push("outside");

  assert.equal(project.isPluginConnected("outside", "frontend"), false);
  assert.equal(Object.isFrozen(project.repositories), true);
  assert.equal(Object.isFrozen(project.toConfig()), true);
  assert.throws(
    () => createProject({ ...projectConfig(), repositories: projectConfig().repositories.slice(1) }),
    /ровно один Store Repository/,
  );

  const invalid = projectConfig();
  invalid.repositories[1].plugins.push("missing");
  assert.throws(() => createProject(invalid), /незарегистрированным Plugin/);
});
