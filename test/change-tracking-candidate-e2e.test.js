/** @fileoverview Изолированный candidate E2E Change Tracking на реальных Git repositories. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  configuration,
  createProject,
  PluginLoader,
  pluginContexts,
  storeProjects,
} from "@openspec-orch/core";

import { ChangeTrackingService } from "../plugins/change-tracking/index.js";
import {
  commitFiles,
  createCheckoutWithRemote,
  runCommand,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../plugins/change-tracking/", import.meta.url));
const CONFIRM = async () => true;

test("candidate Change Tracking completes a real multi-repository Cycle", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orch-change-tracking-candidate-");
  const store = await createCheckoutWithRemote(
    root,
    "workspace/specs",
    "specs",
    { "openspec/config.yaml": "schema: spec-driven\n" },
  );
  const frontend = await createCheckoutWithRemote(
    root,
    "workspace/src/frontend",
    "frontend",
    { "README.md": "frontend\n" },
  );
  const backend = await createCheckoutWithRemote(
    root,
    "workspace/src/backend",
    "backend",
    { "README.md": "backend\n" },
  );
  const pluginId = "change-tracking";
  const pluginSource = "@openspec-orch/plugin-change-tracking@1.0.0";
  const repository = ({ id, role, remote }) => ({
    id,
    role,
    remote,
    defaultBranch: "main",
    plugins: [pluginId],
  });
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [{ id: pluginId, source: pluginSource }],
    repositories: [
      repository({ id: "specs", role: "store", remote: store.remote }),
      repository({ id: "frontend", role: "code", remote: frontend.remote }),
      repository({ id: "backend", role: "code", remote: backend.remote }),
    ],
  });
  await writeFiles(store.checkout, {
    ".gitignore": [
      ".openspec-orch/cache/",
      ".openspec-orch/plugins/",
      ".openspec-orch/state.json",
      "",
    ].join("\n"),
    ".openspec-store/store.yaml": [
      "version: 1",
      "id: specs",
      `remote: ${JSON.stringify(store.remote)}`,
      "",
    ].join("\n"),
    "openspec-orch.yaml": configuration.serializeProject(project),
  });
  await commitFiles(store.checkout, {}, { message: "configure candidate Store" });

  const loadedPlugin = await new PluginLoader().load({
    packageRoot: PLUGIN_ROOT,
    pluginId,
  });
  const storeProject = await storeProjects.load(store.checkout);
  const context = await pluginContexts.forRepository({
    loadedPlugin,
    storeProject,
    repositoryId: "specs",
  });
  const changes = new ChangeTrackingService(context);
  const assigned = await changes.assign({
    changeId: "checkout-flow",
    repositoryIds: ["frontend", "backend"],
    confirm: CONFIRM,
  });
  await runCommand("git", ["-C", store.checkout, "add", assigned.path]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "assign checkout-flow"]);

  for (const [repositoryId, checkout] of [
    ["frontend", frontend.checkout],
    ["backend", backend.checkout],
  ]) {
    const revision = await runCommand("git", ["-C", checkout, "rev-parse", "HEAD"]);
    await changes.recordAssignment({
      changeId: "checkout-flow",
      repositoryId,
      implementationRevision: revision,
      status: "completed",
      source: "agent",
      confirm: CONFIRM,
    });
  }
  const verified = await changes.verify("checkout-flow");
  await changes.recordVerification({
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
    confirm: CONFIRM,
  });

  const status = await changes.status("checkout-flow");
  assert.equal(status.nextAction, "готово");
  assert.equal(status.snapshot.snapshot_id, verified.snapshot.snapshot_id);
  assert.equal(status.verification.result, "pass");
  assert.deepEqual(status.repositories.map(({ repositoryId, state }) => ({
    repositoryId,
    state,
  })), [
    { repositoryId: "frontend", state: "completed" },
    { repositoryId: "backend", state: "completed" },
  ]);
  const statePath = path.join(
    store.checkout,
    ".openspec-orch/plugins/change-tracking/state.json",
  );
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.equal(state.plugin_id, pluginId);
  assert.equal(state.data.result_receipts.length, 2);
  assert.equal(
    await fs.lstat(path.join(store.checkout, ".openspec-orch/state.json"))
      .catch((error) => error.code),
    "ENOENT",
  );
});
