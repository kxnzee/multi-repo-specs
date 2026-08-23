/** @fileoverview Контракт публичного configuration facade нового Core. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configuration,
  CoreConfiguration,
  Project,
  Repository,
  Store,
} from "@openspec-orch/core";

const CURRENT_CONFIG = `version: 3
strict: true
agents: [codex]
plugins:
  - id: dependency-audit
    source: "@test/plugin-dependency-audit@1.0.0"
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: [dependency-audit]
  - id: frontend
    roles: [code]
    remote: https://example.test/frontend.git
    default_branch: main
    plugins: [dependency-audit]
`;

test("configuration parses version 3 YAML directly into the public domain model", () => {
  assert.equal(configuration instanceof CoreConfiguration, true);
  const project = configuration.parseProject(CURRENT_CONFIG);

  assert.equal(project instanceof Project, true);
  assert.equal(project.storeRepository instanceof Repository, true);
  assert.equal(project.storeRepository.id, "specs");
  assert.deepEqual(project.agents, ["codex"]);
  assert.deepEqual(project.plugins, ["dependency-audit"]);
  assert.equal(project.isPluginConnected("dependency-audit", "frontend"), true);
});

test("configuration serializes Project and verifies its own output", () => {
  const project = configuration.parseProject(CURRENT_CONFIG);
  const source = configuration.serializeProject(project);
  const restored = configuration.parseProject(source);

  assert.deepEqual(restored.toConfig(), project.toConfig());
  assert.match(source, /default_branch: main/);
  assert.doesNotMatch(source, /storeRepository|codeRepositories/);
});

test("configuration stores the package identity selected by Plugin Manager", () => {
  const project = configuration.parseProject(CURRENT_CONFIG);

  assert.deepEqual(project.plugins, ["dependency-audit"]);
  assert.equal(project.pluginDeclaration("dependency-audit").source, "@test/plugin-dependency-audit@1.0.0");
  assert.deepEqual(configuration.parseProject(configuration.serializeProject(project)).toConfig(), project.toConfig());
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace(
      `plugins:\n  - id: dependency-audit\n    source: "@test/plugin-dependency-audit@1.0.0"`,
      "plugins: [dependency-audit]",
    )),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace("version: 3", "version: 2")),
    /CONFIG_INVALID/,
  );
});

test("configuration rejects invalid repository and Plugin bindings before domain creation", () => {
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace(
      "https://example.test/frontend.git",
      "/tmp/frontend",
    )),
    /локальным абсолютным путём/,
  );
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace(
      `plugins:\n  - id: dependency-audit\n    source: "@test/plugin-dependency-audit@1.0.0"\nrepositories:`,
      "plugins: []\nrepositories:",
    )),
    /необъявленный plugin-id/,
  );
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace("id: frontend", "id: specs")),
    /повторяющийся repository-id/,
  );
  assert.throws(
    () => configuration.parseProject(CURRENT_CONFIG.replace("roles: [code]", "roles: [store]")),
    /ровно одну запись roles: \[store\]/,
  );
  assert.throws(
    () => configuration.parseProject(`${CURRENT_CONFIG}unknown: true\n`),
    /CONFIG_INVALID/,
  );
});

test("configuration parses Store metadata into Store identity", () => {
  const store = configuration.parseStore(
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );

  assert.equal(store instanceof Store, true);
  assert.deepEqual(store.identity(), {
    id: "specs",
    remote: "https://example.test/specs.git",
  });
  assert.throws(() => configuration.parseStore("version: 2\nid: specs\n"), /version: 1/);
  assert.throws(() => configuration.parseStore("version: 1\nid: Demo\n"), /CONFIG_INVALID/);
});

test("configuration parses the public init repository argument into Repository", () => {
  const repository = configuration.parseRepositoryArgument(
    "frontend=https://example.test/frontend.git#main",
  );

  assert.equal(repository instanceof Repository, true);
  assert.deepEqual(repository.toConfig(), {
    id: "frontend",
    role: "code",
    remote: "https://example.test/frontend.git",
    defaultBranch: "main",
    plugins: [],
  });
  assert.throws(() => configuration.parseRepositoryArgument("Frontend=remote#main"), /Ожидается/);
  assert.throws(() => configuration.parseRepositoryArgument("frontend=/tmp/frontend#main"), /CONFIG_INVALID/);
});
