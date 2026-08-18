/** @fileoverview Текущий repository-id для repository-scoped agent workflows. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { readCurrentRepository } from "../src/internal/repository/current.js";
import { readStoreConfiguration } from "../src/internal/shared/store.js";
import { createCheckoutWithRemote, temporaryDirectory, writeFiles } from "../test-fixtures/workspace.js";

/**
 * Создаёт Store и один подключённый Code Repository в стандартном workspace.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @returns {Promise<object>} Проверенный сценарий.
 */
async function createScenario(t) {
  const workspace = await temporaryDirectory(t, "openspec-orchestrator-current-repository-");
  const store = await createCheckoutWithRemote(workspace, "specs", "specs", {
    "README.md": "# Specs\n",
  });
  const frontend = await createCheckoutWithRemote(workspace, "src/frontend", "frontend", {
    "openspec/config.yaml": "store: specs\n",
  });
  await writeFiles(store.checkout, {
    ".openspec-store/store.yaml": `version: 1\nid: specs\nremote: ${JSON.stringify(store.remote)}\n`,
    "openspec-orch.yaml": [
      "version: 1",
      "strict: true",
      "",
      "repositories:",
      "  - id: specs",
      "    roles: [store]",
      `    remote: ${JSON.stringify(store.remote)}`,
      "    default_branch: main",
      "  - id: frontend",
      "    roles: [code]",
      `    remote: ${JSON.stringify(frontend.remote)}`,
      "    default_branch: main",
      "",
      "extensions: {}",
      "",
    ].join("\n"),
    "openspec/config.yaml": "schema: spec-driven\n",
  });
  const { metadata, config } = await readStoreConfiguration(store.checkout);
  return { storeRoot: store.checkout, frontendRoot: frontend.checkout, metadata, config };
}

test("readCurrentRepository resolves a connected Code Repository from a nested directory", async (t) => {
  const scenario = await createScenario(t);
  const nested = path.join(scenario.frontendRoot, "src", "feature");
  await fs.mkdir(nested, { recursive: true });

  assert.deepEqual(
    await readCurrentRepository({
      start: nested,
      storeRoot: scenario.storeRoot,
      metadata: scenario.metadata,
      config: scenario.config,
    }),
    { id: "frontend", role: "code", path: scenario.frontendRoot },
  );
});

test("readCurrentRepository reports the Store without treating it as a Code Repository", async (t) => {
  const scenario = await createScenario(t);
  assert.deepEqual(
    await readCurrentRepository({
      start: scenario.storeRoot,
      storeRoot: scenario.storeRoot,
      metadata: scenario.metadata,
      config: scenario.config,
    }),
    { id: "specs", role: "store", path: scenario.storeRoot },
  );
});

test("readCurrentRepository rejects a checkout whose origin no longer matches the registry", async (t) => {
  const scenario = await createScenario(t);
  const { runCommand } = await import("../src/internal/shared/command.js");
  await runCommand("git", ["-C", scenario.frontendRoot, "remote", "set-url", "origin", "https://example.test/other.git"]);

  await assert.rejects(
    readCurrentRepository({
      start: scenario.frontendRoot,
      storeRoot: scenario.storeRoot,
      metadata: scenario.metadata,
      config: scenario.config,
    }),
    /REPO_IDENTITY_MISMATCH/,
  );
});
