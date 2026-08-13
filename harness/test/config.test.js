/** @fileoverview Проверка строгой схемы и безопасности sdd.yaml. */

import assert from "node:assert/strict";
import test from "node:test";
import { parseSddConfig, parseStoreMetadata } from "../config/index.js";

/**
 * Создаёт минимальный валидный sdd.yaml для негативных тестов.
 *
 * @param {string} repositories YAML-список repositories.
 * @returns {string} Полный YAML.
 */
function config(repositories) {
  return `versions:
  openspec: "1.7.0"
agent:
  id: qwen
  openspec_adapter: qwen
  architecture: markdown-commands
  commands_directory: .qwen/commands
  instructions_file: QWEN.md
repositories:
${repositories}
`;
}

test("parseSddConfig rejects an unknown repository role", () => {
  assert.throws(
    () => parseSddConfig(config("  - id: specs\n    role: unknown\n    url: https://example.test/specs.git\n    default_branch: main")),
  );
});

test("parseSddConfig rejects duplicate repository ids", () => {
  const repository = "  - id: specs\n    role: store\n    url: https://example.test/specs.git\n    default_branch: main";
  assert.throws(() => parseSddConfig(config(`${repository}\n${repository}`)));
});

test("parseSddConfig blocks credentials embedded in repository URL", () => {
  assert.throws(
    () => parseSddConfig(config("  - id: specs\n    role: store\n    url: https://user:pass@example.test/specs.git\n    default_branch: main")),
  );
});

test("parseSddConfig rejects missing schema sections and repository fields", () => {
  assert.throws(() => parseSddConfig("versions: {}\nagent: {}\nrepositories: []\n"));
  assert.throws(() => parseSddConfig("versions:\n  openspec: '1.7.0'\nrepositories: []\n"));
  assert.throws(
    () => parseSddConfig("versions:\n  openspec: '1.7.0'\nagent: {}\nrepositories: []\n"),
  );
  const prefix = "versions:\n  openspec: '1.7.0'\nagent:\n  id: qwen\n  openspec_adapter: qwen\n  architecture: markdown-commands\n  commands_directory: .qwen/commands\n  instructions_file: QWEN.md\n";
  assert.throws(() => parseSddConfig(`${prefix}repositories:\n  - invalid\n`));
  assert.throws(
    () => parseSddConfig(`${prefix}repositories:\n  - id: specs\n    role: store\n    url: https://example.test/specs.git\n`),
  );
});

test("parseStoreMetadata validates its schema before normalization", () => {
  assert.throws(() => parseStoreMetadata("[]"));
  assert.throws(() => parseStoreMetadata("id: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 2\nid: specs\n"));
  assert.throws(() => parseStoreMetadata("version: 1\nid: specs\nremote: 42\n"));
});
