/** @fileoverview Проверка строгой схемы v1/v2 и безопасности openspec-orch.yaml. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  resolveExecutionMode,
  serializeOrchestratorConfig,
} from "../src/internal/config/index.js";

/**
 * Создаёт минимальный валидный openspec-orch.yaml v1 для негативных тестов.
 *
 * @param {string} repositories YAML-список repositories.
 * @returns {string} Полный YAML.
 */
function config(repositories) {
  return `version: 1\nrepositories:\n${repositories}\n`;
}

const STORE_ONLY = "  - id: specs\n    roles: [store]\n    remote: https://example.test/specs.git\n    default_branch: main";

test("parseOrchestratorConfig rejects an unknown repository role", () => {
  assert.throws(
    () => parseOrchestratorConfig(config("  - id: specs\n    roles: [unknown]\n    remote: https://example.test/specs.git\n    default_branch: main")),
  );
});

test("parseOrchestratorConfig rejects duplicate repository ids", () => {
  assert.throws(() => parseOrchestratorConfig(config(`${STORE_ONLY}\n${STORE_ONLY}`)));
});

test("parseOrchestratorConfig blocks credentials embedded in repository URL", () => {
  assert.throws(
    () => parseOrchestratorConfig(config("  - id: specs\n    roles: [store]\n    remote: https://user:pass@example.test/specs.git\n    default_branch: main")),
  );
});

test("parseOrchestratorConfig rejects local absolute repository remotes", () => {
  for (const remote of [
    "/private/tmp/specs.git",
    "C:\\work\\specs.git",
    "file:///private/tmp/specs.git",
  ]) {
    assert.throws(
      () => parseOrchestratorConfig(config(
        `  - id: specs\n    roles: [store]\n    remote: ${JSON.stringify(remote)}\n    default_branch: main`,
      )),
      /CONFIG_INVALID/,
    );
  }
});

test("parseOrchestratorConfig rejects missing schema sections and repository fields", () => {
  assert.throws(() => parseOrchestratorConfig("repositories: []\n"));
  assert.throws(() => parseOrchestratorConfig("version: 2\nrepositories: []\n"));
  assert.throws(() => parseOrchestratorConfig("version: 1\nrepositories:\n  - invalid\n"));
  assert.throws(
    () => parseOrchestratorConfig("version: 1\nrepositories:\n  - id: specs\n    roles: [store]\n    remote: https://example.test/specs.git\n"),
  );
});

test("parseOrchestratorConfig rejects legacy fields outside extensions", () => {
  assert.throws(() => parseOrchestratorConfig(`${config(STORE_ONLY)}agent:\n  id: test-agent\n`));
  assert.throws(() => parseOrchestratorConfig(
    config("  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main"),
  ));
});

test("parseOrchestratorConfig requires exactly one store repository", () => {
  assert.throws(() => parseOrchestratorConfig(config("  - id: frontend\n    roles: [code]\n    remote: https://example.test/frontend.git\n    default_branch: main")));
  assert.throws(() => parseOrchestratorConfig(config(`${STORE_ONLY}\n${STORE_ONLY.replace("specs", "specs-2")}`)));
});

test("parseOrchestratorConfig accepts a store-only registry and splits code repositories", () => {
  const source = config(`${STORE_ONLY}\n  - id: frontend\n    roles: [code]\n    remote: https://example.test/frontend.git\n    default_branch: main`);
  const parsed = parseOrchestratorConfig(source);
  assert.deepEqual(parsed.storeRepository, {
    id: "specs",
    role: "store",
    remote: "https://example.test/specs.git",
    defaultBranch: "main",
    plugins: [],
  });
  assert.deepEqual(parsed.codeRepositories.map(({ id }) => id), ["frontend"]);
  assert.deepEqual(parsed.agents, []);
  assert.deepEqual(parsed.plugins, []);
  assert.deepEqual(parsed.extensions, {});
});

test("v1 keeps legacy extensions visible so a write cannot drop them silently", () => {
  const parsed = parseOrchestratorConfig(`${config(STORE_ONLY)}extensions:\n  team: payments\n`);
  assert.deepEqual(parsed.extensions, { team: "payments" });
});

test("strict defaults to true and may be disabled without an OpenSpec version pin", () => {
  assert.equal(parseOrchestratorConfig(config(STORE_ONLY)).strict, true);
  assert.equal(parseOrchestratorConfig(`strict: false\n${config(STORE_ONLY)}`).strict, false);
  assert.equal(resolveExecutionMode(true, false), "strict");
  assert.equal(resolveExecutionMode(false, false), "relaxed");
  assert.equal(resolveExecutionMode(true, true), "relaxed");
  assert.throws(() => parseOrchestratorConfig(`strict: disabled\n${config(STORE_ONLY)}`));
});

test("serializeOrchestratorConfig upgrades a v1 Core template to strict v2", () => {
  const template = "version: 1\nstrict: true\n\nrepositories: []\n\nextensions: {}\n";
  const serialized = serializeOrchestratorConfig(template, [
    { id: "specs", role: "store", remote: "https://example.test/specs.git", defaultBranch: "main" },
    { id: "frontend", role: "code", remote: "https://example.test/frontend.git", defaultBranch: "main" },
  ], { strict: false, agents: ["qwen"] });
  const parsed = parseOrchestratorConfig(serialized);
  assert.equal(parsed.strict, false);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.agents, ["qwen"]);
  assert.deepEqual(parsed.plugins, []);
  assert.deepEqual(parsed.storeRepository.id, "specs");
  assert.deepEqual(parsed.codeRepositories.map(({ id }) => id), ["frontend"]);
});

test("parseOrchestratorConfig validates Plugin declarations and repository bindings", () => {
  const parsed = parseOrchestratorConfig(`version: 2
plugins: [dependency-audit]
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: [dependency-audit]
`);
  assert.deepEqual(parsed.plugins, ["dependency-audit"]);
  assert.deepEqual(parsed.storeRepository.plugins, ["dependency-audit"]);

  assert.throws(() => parseOrchestratorConfig(`version: 2
plugins: []
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: [dependency-audit]
`), /необъявленный plugin-id dependency-audit/);
});

test("parseOrchestratorConfig validates registered Agent IDs", () => {
  const source = `version: 2
agents: [qwen, codex]
plugins: []
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: []
`;
  assert.deepEqual(parseOrchestratorConfig(source).agents, ["qwen", "codex"]);
  assert.throws(
    () => parseOrchestratorConfig(source.replace("[qwen, codex]", "[qwen, qwen]")),
    /agents содержит повторяющийся agent-id/,
  );
  assert.throws(
    () => parseOrchestratorConfig(source.replace("[qwen, codex]", "[Qwen]")),
    /lowercase kebab-case/,
  );
});

test("serializeOrchestratorConfig rejects a template with an unsupported version", () => {
  assert.throws(() => serializeOrchestratorConfig("version: 3\nrepositories: []\n", [], {}));
});

test("parseStoreMetadata validates its schema before normalization", () => {
  assert.throws(() => parseStoreMetadata("[]"));
  assert.throws(() => parseStoreMetadata("id: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 2\nid: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 1\nid: specs\nremote: 42\n"));
});
