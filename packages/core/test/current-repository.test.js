/** @fileoverview Command Store and current Repository resolution regression tests. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configuration,
  createProject,
  CurrentRepositoryService,
  OpenSpecPointerService,
  StoreProjectService,
} from "@openspec-orch/core";

/** Creates a standard Workspace with a Store and one Code Repository pointer. */
async function commandWorkspace(t) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-command-context-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const storeRoot = path.join(workspaceRoot, "specs");
  const repositoryRoot = path.join(workspaceRoot, "src", "frontend");
  await fs.mkdir(path.join(storeRoot, ".openspec-store"), { recursive: true });
  await fs.mkdir(path.join(storeRoot, "openspec"));
  await fs.mkdir(path.join(repositoryRoot, "openspec"), { recursive: true });
  await fs.mkdir(path.join(repositoryRoot, ".git"));
  const project = createProject({
    version: 1,
    strict: true,
    agents: ["codex"],
    plugins: [{ id: "change-tracking", source: "@test/change-tracking@1.0.0" }],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: ["change-tracking"],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: ["change-tracking"],
      },
    ],
  });
  await fs.writeFile(
    path.join(storeRoot, ".openspec-store/store.yaml"),
    "version: 1\nid: specs\nremote: https://example.test/specs.git\n",
  );
  await fs.writeFile(
    path.join(storeRoot, "openspec-orch.yaml"),
    configuration.serializeProject(project),
  );
  await fs.writeFile(path.join(storeRoot, "openspec/config.yaml"), "schema: spec-driven\n");
  await fs.writeFile(path.join(repositoryRoot, "openspec/config.yaml"), "store: specs\n");
  return {
    repositoryRoot: await fs.realpath(repositoryRoot),
    storeRoot: await fs.realpath(storeRoot),
    workspaceRoot: await fs.realpath(workspaceRoot),
  };
}

test("StoreProjectService resolves a Code Repository pointer through OpenSpec context", async (t) => {
  const fixture = await commandWorkspace(t);
  const calls = [];
  const executor = async (executable, args, options) => {
    calls.push({ executable, args, cwd: options.cwd });
    return {
      failed: false,
      stderr: "",
      stdout: JSON.stringify({
        root: { path: fixture.storeRoot, source: "declared", store_id: "specs" },
      }),
    };
  };
  const service = new StoreProjectService(
    configuration,
    new OpenSpecPointerService(undefined, executor),
  );

  const storeProject = await service.resolve(path.join(fixture.repositoryRoot, "openspec"));
  assert.equal(storeProject.root, fixture.storeRoot);
  assert.equal(storeProject.store.id, "specs");
  assert.deepEqual(calls, [{
    executable: "openspec",
    args: ["context", "--json"],
    cwd: fixture.repositoryRoot,
  }]);
});

test("CurrentRepositoryService identifies and validates the invoking Code Repository", async (t) => {
  const fixture = await commandWorkspace(t);
  const storeProject = await new StoreProjectService().load(fixture.storeRoot);
  const checked = [];
  const service = new CurrentRepositoryService({
    gitService: {
      forRepository(checkout) {
        return {
          async assertIdentity() { checked.push(checkout.id); },
        };
      },
    },
    stateService: {
      forStore() {
        return { async read() { return { workspace: fixture.workspaceRoot }; } };
      },
    },
  });

  const current = await service.resolve({
    start: path.join(fixture.repositoryRoot, "openspec"),
    storeProject,
  });
  assert.deepEqual(current, {
    id: "frontend",
    role: "code",
    path: fixture.repositoryRoot,
  });
  assert.deepEqual(checked, ["frontend"]);
});
