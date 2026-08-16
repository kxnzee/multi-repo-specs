/** @fileoverview Интеграционные тесты read-only `repository status`. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import { serializeOrchestratorConfig } from "../src/internal/config/index.js";
import { readRepositoryStatus } from "../src/internal/repository/index.js";
import {
  commitFiles,
  createCheckoutWithRemote,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const TEMPLATE = "version: 1\nstrict: true\n\nrepositories: []\n\nextensions: {}\n";

/**
 * Собирает Store в стандартной раскладке `<workspace>/<store-id>` с одним подключённым
 * Code Repository в `<workspace>/src/frontend`.
 *
 * @param {import("node:test").TestContext} t Контекст текущего теста.
 * @returns {Promise<{workspace: string, storeRoot: string, frontendRoot: string}>} Пути сценария.
 */
async function createConnectedScenario(t) {
  const root = await temporaryDirectory(t, "openspec-orchestrator-repo-status-");
  const { checkout: storeRoot, remote: storeRemote } = await createCheckoutWithRemote(
    root,
    "workspace/specs",
    "specs",
    { "README.md": "specs\n" },
  );
  const { checkout: frontendRoot, remote: frontendRemote } = await createCheckoutWithRemote(
    root,
    "workspace/src/frontend",
    "frontend",
    { "README.md": "frontend\n" },
  );
  const workspace = path.join(root, "workspace");
  await writeFiles(storeRoot, {
    ".openspec-store/store.yaml": `version: 1\nid: specs\nremote: ${JSON.stringify(storeRemote)}\n`,
    "openspec-orch.yaml": serializeOrchestratorConfig(TEMPLATE, [
      { id: "specs", role: "store", remote: storeRemote, defaultBranch: "main" },
      { id: "frontend", role: "code", remote: frontendRemote, defaultBranch: "main" },
    ]),
  });
  await commitFiles(storeRoot, {}, { message: "configure store" });
  return { workspace, storeRoot, frontendRoot };
}

test("readRepositoryStatus reports a fully connected clean registry without side effects", async (t) => {
  const scenario = await createConnectedScenario(t);
  const statuses = await readRepositoryStatus({ storeRoot: scenario.storeRoot });

  assert.deepEqual(statuses.map(({ id, state }) => ({ id, state })), [
    { id: "specs", state: "connected" },
    { id: "frontend", state: "connected" },
  ]);
  for (const status of statuses) {
    assert.equal(status.clean, true);
    assert.equal(status.remoteMatches, true);
    assert.equal(status.branchMatches, true);
    assert.equal(status.branch, "main");
  }
});

test("readRepositoryStatus reports a missing checkout without cloning it", async (t) => {
  const scenario = await createConnectedScenario(t);
  await fs.rm(scenario.frontendRoot, { recursive: true, force: true });

  const statuses = await readRepositoryStatus({
    storeRoot: scenario.storeRoot,
    repositoryIds: ["frontend"],
  });

  assert.deepEqual(statuses, [{
    id: "frontend",
    role: "code",
    path: scenario.frontendRoot,
    connected: false,
    state: "missing",
  }]);
  assert.equal(await fs.stat(scenario.frontendRoot).catch(() => null), null);
});

test("readRepositoryStatus reports an uncommitted checkout as not clean without fixing it", async (t) => {
  const scenario = await createConnectedScenario(t);
  await fs.writeFile(path.join(scenario.frontendRoot, "local.txt"), "dirty\n", "utf8");

  const [status] = await readRepositoryStatus({
    storeRoot: scenario.storeRoot,
    repositoryIds: ["frontend"],
  });

  assert.equal(status.connected, true);
  assert.equal(status.clean, false);
  assert.equal(
    await fs.readFile(path.join(scenario.frontendRoot, "local.txt"), "utf8"),
    "dirty\n",
  );
});

test("readRepositoryStatus rejects an unknown --repo filter", async (t) => {
  const scenario = await createConnectedScenario(t);
  await assert.rejects(
    readRepositoryStatus({ storeRoot: scenario.storeRoot, repositoryIds: ["mobile"] }),
    /REPO_UNKNOWN/,
  );
});
