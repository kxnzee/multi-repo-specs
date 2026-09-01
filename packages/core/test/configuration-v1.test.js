/** @fileoverview Публичный транспортный контракт openspec-orch.yaml v1. */

import assert from "node:assert/strict";
import test from "node:test";

import { configuration } from "@openspec-orch/core";

const CONFIG_V1 = `version: 1
strict: true
template:
  id: default
agent:
  id: qwen
extensions:
  - id: superpowers
    source: bundled:superpowers
  - id: spec-driven-extended
    source: bundled:spec-driven-extended
plugins:
  - id: codegraph
    source: "@openspec-orch/plugin-codegraph@1.0.0"
repositories:
  - id: specs
    roles: [store]
    remote: https://example.test/specs.git
    default_branch: main
    plugins: []
  - id: frontend
    roles: [code]
    remote: https://example.test/frontend.git
    default_branch: main
    plugins: [codegraph]
`;

test("configuration parses and serializes the exact Project v1 assembly", () => {
  const project = configuration.parseProject(CONFIG_V1);

  assert.equal(project.version, 1);
  assert.deepEqual(project.template, { id: "default" });
  assert.deepEqual(project.agent, { id: "qwen" });
  assert.deepEqual(project.extensionDeclarations.map((entry) => entry.toConfig()), [
    { id: "superpowers", source: "bundled:superpowers" },
    { id: "spec-driven-extended", source: "bundled:spec-driven-extended" },
  ]);
  assert.deepEqual(project.pluginDeclarations.map((entry) => entry.toConfig()), [
    { id: "codegraph", source: "@openspec-orch/plugin-codegraph@1.0.0" },
  ]);
  assert.equal(Object.isFrozen(project.template), true);
  assert.equal(Object.isFrozen(project.agent), true);

  const serialized = configuration.serializeProject(project);
  assert.match(serialized, /^version: 1$/m);
  assert.match(serialized, /^template:\n {2}id: default$/m);
  assert.match(serialized, /^agent:\n {2}id: qwen$/m);
  assert.equal(serialized.indexOf("id: superpowers") < serialized.indexOf("id: spec-driven-extended"), true);
  assert.deepEqual(configuration.parseProject(serialized).toConfig(), project.toConfig());
});

test("configuration v1 rejects unsupported versions, legacy fields and duplicate Extensions", () => {
  assert.throws(
    () => configuration.parseProject(CONFIG_V1.replace("version: 1", "version: 2")),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => configuration.parseProject(CONFIG_V1.replace("agent:\n  id: qwen", "agents: [qwen]")),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => configuration.parseProject(CONFIG_V1.replace(
      'source: "@openspec-orch/plugin-codegraph@1.0.0"',
      'source: "@openspec-orch/plugin-codegraph@1.0.0"\n    required: true',
    )),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => configuration.parseProject(CONFIG_V1.replace(
      "  - id: spec-driven-extended\n    source: bundled:spec-driven-extended",
      "  - id: superpowers\n    source: bundled:superpowers",
    )),
    /повторяющийся extension-id/,
  );
});
