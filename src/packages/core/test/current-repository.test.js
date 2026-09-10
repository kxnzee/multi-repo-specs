/** @fileoverview Command Store and current Repository resolution regression tests. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execa } from "execa";

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
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: ["sample"],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: ["sample"],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: ["sample"],
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

test("CurrentRepositoryService identifies the invoking Code directory without Git", async (t) => {
  const fixture = await commandWorkspace(t);
  const storeProject = await new StoreProjectService().load(fixture.storeRoot);
  await fs.rm(path.join(fixture.repositoryRoot, ".git"), { recursive: true, force: true });
  await fs.mkdir(path.join(fixture.workspaceRoot, ".git"));
  const service = new CurrentRepositoryService({
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
});


test("current repository recognizes external Git worktrees and rejects unrelated nested repositories", async (t) => {
  const fixture = await commandWorkspace(t);
  const storeProject = await new StoreProjectService().load(fixture.storeRoot);
  const run = (...args) => execa("git", args, { cwd: fixture.repositoryRoot });
  await run("init", "--initial-branch=main");
  await run("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "base");
  const external = path.join(fixture.workspaceRoot, "external-worktree");
  await run("worktree", "add", "-b", "task", external);
  const service = new CurrentRepositoryService();
  assert.deepEqual(await service.resolve({ start: external, storeProject }), {
    id: "frontend", role: "code", path: external,
  });
  const unrelated = path.join(fixture.repositoryRoot, "unrelated");
  await fs.mkdir(unrelated);
  await execa("git", ["init", "--initial-branch=main"], { cwd: unrelated });
  assert.equal(await service.resolve({ start: unrelated, storeProject }), null);
});
