/** @fileoverview Изолированный candidate E2E Change Tracking на реальных Git repositories. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  configuration,
  createProject,
  PluginLoader,
  pluginContexts,
  storeProjects,
} from "@openspec-orch/core";

import { ChangeTrackingService } from "../plugins/change-tracking/lib/service.js";
import {
  commitFiles,
  createCheckoutWithRemote,
  runCommand,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../plugins/change-tracking/", import.meta.url));

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
    version: 2,
    strict: true,
    template: { id: "base" },
    agent: { id: "qwen" },
    extensions: [],
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
    "openspec/changes/checkout-flow/proposal.md": [
      "# Checkout flow",
      "",
      "## Repository Impact",
      "",
      "| Repository | Capabilities |",
      "|---|---|",
      "| frontend | checkout |",
      "| backend | checkout |",
      "",
    ].join("\n"),
    "openspec/changes/checkout-flow/design.md": "# Design\n",
    "openspec/changes/checkout-flow/specs/checkout/spec.md": "# Checkout spec\n",
    "openspec/changes/checkout-flow/tasks.md": "# Tasks\n",
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
  const assigned = await changes.track({ changeId: "checkout-flow" });
  await runCommand("git", ["-C", store.checkout, "add", assigned.path]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "track checkout-flow"]);

  let currentSnapshot;
  for (const [repositoryId, checkout] of [
    ["frontend", frontend.checkout],
    ["backend", backend.checkout],
  ]) {
    const codeContext = await pluginContexts.forRepository({
      loadedPlugin,
      storeProject,
      repositoryId: "specs",
      invocation: { id: repositoryId, role: "code", path: checkout },
    });
    const result = await new ChangeTrackingService(codeContext).done({
      changeId: "checkout-flow",
      source: "agent",
    });
    currentSnapshot = result.snapshot ?? currentSnapshot;
  }
  await changes.verifyResult({
    changeId: "checkout-flow",
    result: "pass",
    source: "human",
  });

  const status = await changes.status("checkout-flow");
  assert.equal(status.snapshot.snapshot_id, currentSnapshot.snapshot_id);
  assert.equal(status.verification.result, "pass");
  assert.deepEqual(status.repositories.map(({ repositoryId }) => repositoryId), [
    "frontend",
    "backend",
  ]);
  assert.equal(status.repositories.every(
    ({ receipt }) => /^[0-9a-f]{40}$/u.test(receipt.implementation_revision),
  ), true);
  const frontendJournal = parse(await fs.readFile(path.join(
    store.checkout,
    "tracking/cycles/checkout-flow/receipts/frontend.yaml",
  ), "utf8"));
  assert.equal(frontendJournal.receipts.length, 1);
  assert.equal(frontendJournal.receipts[0].repository_id, "frontend");
  assert.equal(
    await fs.lstat(path.join(store.checkout, ".openspec-orch/plugins/change-tracking/state.json"))
      .catch((error) => error.code),
    "ENOENT",
  );
  assert.equal(
    await fs.lstat(path.join(store.checkout, ".openspec-orch/state.json"))
      .catch((error) => error.code),
    "ENOENT",
  );
});
