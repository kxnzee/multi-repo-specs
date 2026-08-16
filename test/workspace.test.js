/** @fileoverview Юнит-тесты локального `.openspec-orch/state.json` и разрешения workspace. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  inferStandardWorkspace,
  rememberWorkspace,
  resolveCodeWorkspace,
  resolveWorkspace,
} from "../src/internal/shared/workspace.js";
import { temporaryDirectory } from "../test-fixtures/workspace.js";

test("inferStandardWorkspace accepts only the <workspace>/<store-id> layout", () => {
  assert.equal(inferStandardWorkspace("/work/payments-specs", "payments-specs"), "/work");
  assert.equal(inferStandardWorkspace("/work/central-store", "payments-specs"), null);
  assert.equal(inferStandardWorkspace("/work/openspec/payments-specs", "payments-specs"), null);
});

test("resolveWorkspace prefers an explicit argument over a stored state.json workspace", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  const storedWorkspace = path.join(root, "stored");
  const explicitWorkspace = path.join(root, "explicit");
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.mkdir(storedWorkspace, { recursive: true });
  await fs.mkdir(explicitWorkspace, { recursive: true });
  await rememberWorkspace(storeRoot, storedWorkspace);

  const resolved = await resolveWorkspace(storeRoot, "specs", explicitWorkspace);
  assert.equal(resolved, await fs.realpath(explicitWorkspace));
});

test("resolveWorkspace round-trips a remembered workspace through state.json", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  const workspace = path.join(root, "team-workspace");
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });

  await rememberWorkspace(storeRoot, workspace);
  const resolved = await resolveWorkspace(storeRoot, "specs", undefined);
  assert.equal(resolved, await fs.realpath(workspace));

  const state = JSON.parse(
    await fs.readFile(path.join(storeRoot, ".openspec-orch", "state.json"), "utf8"),
  );
  assert.deepEqual(state, { contract_version: 1, workspace });
});

test("resolveWorkspace falls back to the standard <workspace>/<store-id> layout", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  await fs.mkdir(storeRoot, { recursive: true });

  const resolved = await resolveWorkspace(storeRoot, "specs", undefined);
  assert.equal(resolved, await fs.realpath(root));
});

test("resolveWorkspace ignores a stored workspace when useWorkspaceState is false", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  const storedWorkspace = path.join(root, "stored");
  await fs.mkdir(storeRoot, { recursive: true });
  await fs.mkdir(storedWorkspace, { recursive: true });
  await rememberWorkspace(storeRoot, storedWorkspace);

  const resolved = await resolveWorkspace(storeRoot, "specs", undefined, false);
  assert.equal(resolved, await fs.realpath(root));
});

test("resolveWorkspace rejects a corrupted state.json instead of overwriting it", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  await fs.mkdir(path.join(storeRoot, ".openspec-orch"), { recursive: true });
  await fs.writeFile(path.join(storeRoot, ".openspec-orch", "state.json"), "not json", "utf8");

  await assert.rejects(resolveWorkspace(storeRoot, "specs", undefined));
  assert.equal(
    await fs.readFile(path.join(storeRoot, ".openspec-orch", "state.json"), "utf8"),
    "not json",
  );
});

test("resolveWorkspace rejects an unsupported state.json contract_version", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const storeRoot = path.join(root, "specs");
  await fs.mkdir(path.join(storeRoot, ".openspec-orch"), { recursive: true });
  await fs.writeFile(
    path.join(storeRoot, ".openspec-orch", "state.json"),
    JSON.stringify({ contract_version: 2, workspace: null }),
    "utf8",
  );

  await assert.rejects(resolveWorkspace(storeRoot, "specs", undefined));
});

test("resolveCodeWorkspace requires the <workspace>/src/<repository-id> layout", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orchestrator-workspace-");
  const repositoryRoot = path.join(root, "workspace", "src", "frontend");
  await fs.mkdir(repositoryRoot, { recursive: true });

  assert.equal(await resolveCodeWorkspace(repositoryRoot), await fs.realpath(path.join(root, "workspace")));
  await assert.rejects(resolveCodeWorkspace(path.join(root, "workspace", "frontend")));
});
