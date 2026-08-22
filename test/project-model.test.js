/** @fileoverview Доменный ProjectModel скрывает структуру repository и Plugin arrays. */

import assert from "node:assert/strict";
import test from "node:test";

import { createProjectModel } from "../src/internal/config/project.js";

/** Возвращает проверенный fixture нормализованной конфигурации. */
function projectConfig() {
  const repositories = [
    { id: "specs", role: "store", remote: "https://example.test/specs.git", defaultBranch: "main", plugins: [] },
    { id: "frontend", role: "code", remote: "https://example.test/frontend.git", defaultBranch: "main", plugins: [] },
    { id: "backend", role: "code", remote: "https://example.test/backend.git", defaultBranch: "main", plugins: [] },
  ];
  return {
    version: 2,
    strict: true,
    plugins: [],
    extensions: {},
    repositories,
    storeRepository: repositories[0],
    codeRepositories: repositories.slice(1),
  };
}

test("ProjectModel provides repository selection without exposing lookup rules to callers", () => {
  const project = createProjectModel(projectConfig());
  assert.equal(project.requireRepository("frontend").role, "code");
  assert.deepEqual(
    project.selectRepositories(["backend", "specs"]).map(({ id }) => id),
    ["specs", "backend"],
  );
  assert.throws(() => project.requireRepository("missing"), /REPO_UNKNOWN/);
});

test("ProjectModel owns Plugin registration and repository bindings", () => {
  const project = createProjectModel(projectConfig());
  project.registerPlugins(["dependency-audit"]);
  project.connectPlugin("dependency-audit", ["frontend", "backend"]);

  assert.equal(project.hasPlugin("dependency-audit"), true);
  assert.throws(() => project.requirePlugin("missing"), /PLUGIN_NOT_INITIALIZED/);
  assert.equal(project.isPluginConnected("dependency-audit", "frontend"), true);
  assert.deepEqual(
    project.pluginConnections().map(({ pluginId, repository }) => [pluginId, repository.id]),
    [["dependency-audit", "frontend"], ["dependency-audit", "backend"]],
  );
  assert.throws(
    () => project.pluginConnections({ pluginId: "missing" }),
    /PLUGIN_NOT_INITIALIZED/,
  );
  assert.throws(
    () => project.pluginConnections({ repositoryId: "missing" }),
    /REPO_UNKNOWN/,
  );
  assert.throws(() => project.removePlugin("dependency-audit"), /PLUGIN_CONNECTED/);

  assert.equal(project.disconnectPlugin("dependency-audit", "frontend"), true);
  assert.equal(project.disconnectPlugin("dependency-audit", "frontend"), false);
  assert.equal(project.disconnectPlugin("dependency-audit", "backend"), true);
  assert.equal(project.removePlugin("dependency-audit"), true);
  assert.deepEqual(project.toConfig().plugins, []);
  assert.deepEqual(project.toConfig().repositories.map(({ plugins }) => plugins), [[], [], []]);
});

test("ProjectModel owns an immutable config snapshot", () => {
  const source = projectConfig();
  const project = createProjectModel(source);

  source.repositories[1].plugins.push("outside");
  assert.equal(project.isPluginConnected("outside", "frontend"), false);
  assert.throws(() => project.repositories.push(source.repositories[1]), TypeError);
  assert.throws(() => project.repositories[1].plugins.push("outside"), TypeError);
  assert.throws(() => project.toConfig().plugins.push("outside"), TypeError);

  project.registerPlugins(["dependency-audit"]);
  project.connectPlugin("dependency-audit", ["frontend"]);
  assert.equal(project.isPluginConnected("dependency-audit", "frontend"), true);
});

test("ProjectModel owns the legacy-extension migration guard", () => {
  const config = projectConfig();
  config.extensions = { team: "payments" };
  const project = createProjectModel(config);

  assert.throws(() => project.assertPluginInitializationAllowed(), /CONFIG_MIGRATION_REQUIRED/);
});
