/** @fileoverview Проверка строгой схемы и безопасности openspec-orch.yaml. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOrchestratorConfig,
  parseStoreMetadata,
  resolveExecutionMode,
  serializeOrchestratorConfig,
} from "../src/config/index.js";

/**
 * Создаёт минимальный валидный openspec-orch.yaml для негативных тестов.
 *
 * @param {string} repositories YAML-список repositories.
 * @returns {string} Полный YAML.
 */
function config(repositories) {
  return `agent:
  id: qwen
  openspec_adapter: qwen
  architecture: markdown-commands
  commands_directory: .qwen/commands
  instructions_file: QWEN.md
repositories:
${repositories}
`;
}

test("parseOrchestratorConfig rejects an unknown repository role", () => {
  assert.throws(
    () => parseOrchestratorConfig(config("  - id: specs\n    role: unknown\n    url: https://example.test/specs.git\n    default_branch: main")),
  );
});

test("parseOrchestratorConfig rejects duplicate repository ids", () => {
  const repository = "  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main";
  assert.throws(() => parseOrchestratorConfig(config(`${repository}\n${repository}`)));
});

test("parseOrchestratorConfig blocks credentials embedded in repository URL", () => {
  assert.throws(
    () => parseOrchestratorConfig(config("  - id: specs\n    role: store\n    url: https://user:pass@example.test/specs.git\n    default_branch: main")),
  );
});

test("parseOrchestratorConfig rejects missing schema sections and repository fields", () => {
  assert.throws(() => parseOrchestratorConfig("agent: {}\nrepositories: []\n"));
  assert.throws(() => parseOrchestratorConfig("repositories: []\n"));
  assert.throws(
    () => parseOrchestratorConfig("agent: {}\nrepositories: []\n"),
  );
  const prefix = "agent:\n  id: qwen\n  openspec_adapter: qwen\n  architecture: markdown-commands\n  commands_directory: .qwen/commands\n  instructions_file: QWEN.md\n";
  assert.throws(() => parseOrchestratorConfig(`${prefix}repositories:\n  - invalid\n`));
  assert.throws(
    () => parseOrchestratorConfig(`${prefix}repositories:\n  - id: specs\n    role: store\n    url: https://example.test/specs.git\n`),
  );
});

test("strict defaults to true and may be disabled without an OpenSpec version pin", () => {
  const repositories =
    "  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main";
  assert.equal(parseOrchestratorConfig(config(repositories)).strict, true);
  assert.equal(parseOrchestratorConfig(`strict: false\n${config(repositories)}`).strict, false);
  assert.equal(resolveExecutionMode(true, false), "strict");
  assert.equal(resolveExecutionMode(false, false), "relaxed");
  assert.equal(resolveExecutionMode(true, true), "relaxed");
  assert.throws(() => parseOrchestratorConfig(`strict: disabled\n${config(repositories)}`));
});

test("serializeOrchestratorConfig removes a legacy version pin", () => {
  const source = `version: 1\nversions:\n  openspec: "1.7.0"\nagent: null\nrepositories: []\n`;
  const serialized = serializeOrchestratorConfig(source, [{
    id: "specs", role: "store", url: "https://example.test/specs.git", defaultBranch: "main",
  }], {
    id: "qwen",
    openSpecId: "qwen",
    architecture: "markdown-commands",
    commandsDirectory: ".qwen/commands",
    instructionsFile: "QWEN.md",
  }, false);
  assert.doesNotMatch(serialized, /versions:|openspec: "1\.7\.0"/);
  assert.equal(parseOrchestratorConfig(serialized).strict, false);
});

test("parseOrchestratorConfig accepts a Template-defined agent without a Core registry", () => {
  const source = config(
    "  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main",
  )
    .replace("id: qwen", "id: team-agent")
    .replace("openspec_adapter: qwen", "openspec_adapter: custom-adapter")
    .replace("commands_directory: .qwen/commands", "commands_directory: .team/actions")
    .replace("instructions_file: QWEN.md", "instructions_file: TEAM.md\n  handoffs:\n    explore: workflow/explore.md");

  assert.deepEqual(parseOrchestratorConfig(source).agent, {
    id: "team-agent",
    openSpecId: "custom-adapter",
    architecture: "markdown-commands",
    commandsDirectory: ".team/actions",
    instructionsFile: "TEAM.md",
    handoffs: { explore: "workflow/explore.md" },
  });
});

test("parseOrchestratorConfig rejects unsafe dynamic agent paths", () => {
  const repositories =
    "  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main";
  assert.throws(() => parseOrchestratorConfig(
    config(repositories).replace(".qwen/commands", "../outside"),
  ));
  assert.throws(() => parseOrchestratorConfig(
    config(repositories).replace("instructions_file: QWEN.md", "instructions_file: QWEN.md\n  handoffs:\n    apply: /tmp/apply.md"),
  ));
});

test("parseStoreMetadata validates its schema before normalization", () => {
  assert.throws(() => parseStoreMetadata("[]"));
  assert.throws(() => parseStoreMetadata("id: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 2\nid: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 1\nid: specs\nremote: 42\n"));
});
