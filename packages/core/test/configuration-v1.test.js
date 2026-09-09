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
  - superpowers
  - spec-driven-extended
plugins:
  - codegraph
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
    "superpowers",
    "spec-driven-extended",
  ]);
  assert.deepEqual(project.pluginDeclarations.map((entry) => entry.toConfig()), [
    "codegraph",
  ]);
  assert.equal(Object.isFrozen(project.template), true);
  assert.equal(Object.isFrozen(project.agent), true);

  const serialized = configuration.serializeProject(project);
  assert.match(serialized, /^version: 1$/m);
  assert.match(serialized, /^template:\n {2}id: default$/m);
  assert.match(serialized, /^agent:\n {2}id: qwen$/m);
  assert.equal(serialized.indexOf("- superpowers") < serialized.indexOf("- spec-driven-extended"), true);
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
      "  - codegraph",
      "  - id: codegraph\n    source: '@openspec-orch/plugin-codegraph@1.0.0'",
    )),
    /CONFIG_INVALID/,
  );
  assert.throws(
    () => configuration.parseProject(CONFIG_V1.replace(
      "  - spec-driven-extended",
      "  - superpowers",
    )),
    /повторяющийся extension-id/,
  );
});


test("repository descriptions survive YAML round trips and binding changes", () => {
  const description = "Личный кабинет: заказы и оплата.\nReact, TypeScript.";
  const source = CONFIG_V1.replace("    roles: [code]", `    description: ${JSON.stringify(description)}\n    roles: [code]`);
  const project = configuration.parseProject(source);
  const repository = project.requireRepository("frontend");
  assert.equal(repository.description, description);
  assert.equal(repository.disconnectPlugin("codegraph").connectPlugin("codegraph").description, description);
  project.declarePlugin("audit");
  const restored = configuration.parseProject(configuration.serializeProject(project));
  assert.equal(restored.requireRepository("frontend").description, description);
  assert.equal(Object.hasOwn(restored.storeRepository.toConfig(), "description"), false);
  assert.equal(restored.version, 1);
});

test("repository descriptions reject empty and non-string values", () => {
  for (const value of ['""', '"   "', 'null', '42', 'true', '[]', '{}']) {
    assert.throws(() => configuration.parseProject(CONFIG_V1.replace(
      "    roles: [code]", `    description: ${value}\n    roles: [code]`,
    )), /CONFIG_INVALID/);
  }
});


test("specs identity survives bindings and YAML while the owning Store stays unique", () => {
  const source = CONFIG_V1 + `  - id: payments
    roles: [specs]
    store_id: team-payments
    remote: https://example.test/team-payments.git
    default_branch: main
    plugins: []
`;
  const project = configuration.parseProject(source);
  assert.equal(project.storeRepository.id, "specs");
  assert.deepEqual(project.codeRepositories.map(({ id }) => id), ["frontend"]);
  assert.deepEqual(project.specsRepositories.map(({ id }) => id), ["payments"]);
  project.connectPlugin("codegraph", ["payments"]);
  const restored = configuration.parseProject(configuration.serializeProject(project));
  assert.equal(restored.requireRepository("payments").storeId, "team-payments");
  assert.equal(restored.requireRepository("payments").disconnectPlugin("codegraph").storeId, "team-payments");
  assert.throws(() => configuration.parseProject(source.replace("https://example.test/team-payments.git", "https://example.test/specs.git")), /собственный Store/);
  assert.equal(configuration.parseProject(source.replace("store_id: team-payments", "store_id: specs")).specsRepositories[0].storeId, "specs");
  assert.throws(() => configuration.parseProject(source.replace("    store_id: team-payments\n", "")), /storeId/);
  assert.throws(() => configuration.parseProject(source.replace("roles: [specs]", "roles: [code]")), /storeId/);
});
