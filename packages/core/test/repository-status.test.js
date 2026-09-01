/** @fileoverview Characterization read-only `repository status` нового Core. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { execa } from "execa";

import {
  CandidateCli,
  CoreConfiguration,
  Project,
  Repository,
  RepositoryStatus,
  RepositoryStatusService,
} from "@openspec-orch/core";

/** Создаёт Git repository с origin и первым commit. */
async function initializeRepository(root, remote, files) {
  await fs.mkdir(root, { recursive: true });
  await execa("git", ["init", "--initial-branch", "main", root]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  await execa("git", ["-C", root, "add", "."]);
  await execa("git", [
    "-C", root,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.test",
    "commit", "-m", "initial",
  ]);
  await execa("git", ["-C", root, "remote", "add", "origin", remote]);
}

/** Собирает стандартный Store и подключённый Code Repository. */
async function repositoryScenario(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-repo-status-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const storeRoot = path.join(workspace, "specs");
  const frontendRoot = path.join(workspace, "src/frontend");
  const storeRemote = "https://example.test/specs.git";
  const frontendRemote = "https://example.test/frontend.git";
  const configuration = new CoreConfiguration();
  const project = new Project({
    version: 1,
    strict: true,
    template: { id: "default" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [],
    repositories: [
      new Repository({
        id: "specs",
        role: "store",
        remote: storeRemote,
        defaultBranch: "main",
        plugins: [],
      }),
      new Repository({
        id: "frontend",
        role: "code",
        remote: frontendRemote,
        defaultBranch: "main",
        plugins: [],
      }),
    ],
  });
  await initializeRepository(storeRoot, storeRemote, {
    ".openspec-store/store.yaml": `version: 1\nid: specs\nremote: ${storeRemote}\n`,
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec-orch.yaml": configuration.serializeProject(project),
  });
  await initializeRepository(frontendRoot, frontendRemote, { "README.md": "frontend\n" });
  return { workspace, storeRoot, frontendRoot };
}

test("RepositoryStatusService reports a connected clean registry without mutations", async (t) => {
  const scenario = await repositoryScenario(t);
  const statuses = await new RepositoryStatusService().inspect({ start: scenario.storeRoot });

  assert.equal(statuses.every((status) => status instanceof RepositoryStatus), true);
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

test("RepositoryStatusService reports missing and dirty checkouts without fixing them", async (t) => {
  const scenario = await repositoryScenario(t);
  await fs.writeFile(path.join(scenario.frontendRoot, "local.txt"), "dirty\n", "utf8");
  const [dirty] = await new RepositoryStatusService().inspect({
    start: path.join(scenario.storeRoot, "openspec"),
    repositoryIds: ["frontend"],
  });

  assert.equal(dirty.connected, true);
  assert.equal(dirty.clean, false);
  assert.equal(await fs.readFile(path.join(scenario.frontendRoot, "local.txt"), "utf8"), "dirty\n");

  await fs.rm(scenario.frontendRoot, { recursive: true, force: true });
  const [missing] = await new RepositoryStatusService().inspect({
    start: scenario.storeRoot,
    repositoryIds: ["frontend"],
  });
  assert.equal(missing.state, "missing");
  assert.equal(missing.connected, false);
  assert.equal(await fs.stat(scenario.frontendRoot).catch(() => null), null);
});

test("RepositoryStatusService rejects unknown filters and corrupted Core state", async (t) => {
  const scenario = await repositoryScenario(t);
  const service = new RepositoryStatusService();
  await assert.rejects(
    service.inspect({ start: scenario.storeRoot, repositoryIds: ["mobile"] }),
    /REPO_UNKNOWN/,
  );
  await fs.mkdir(path.join(scenario.storeRoot, ".openspec-orch"));
  await fs.writeFile(path.join(scenario.storeRoot, ".openspec-orch/state.json"), "not json", "utf8");
  await assert.rejects(
    service.inspect({ start: scenario.storeRoot, repositoryIds: ["frontend"] }),
    /STATE_CORRUPTED/,
  );
});

test("CandidateCli preserves repository status filters", async () => {
  const calls = [];
  const cli = new CandidateCli({
    repositoryStatusService: {
      async inspect(options) {
        calls.push(options);
        return [];
      },
    },
  });

  await cli.createProgram().parseAsync([
    "node",
    "openspec-orch",
    "repository",
    "status",
    "--repo",
    "frontend",
    "--repo",
    "backend",
  ]);
  assert.deepEqual(calls, [{ repositoryIds: ["frontend", "backend"] }]);
});

test("CandidateCli presents repository status with visual checks", async (t) => {
  const output = [];
  t.mock.method(console, "log", (value) => output.push(value));
  const cli = new CandidateCli({
    repositoryStatusService: {
      async inspect() {
        return [{
          id: "frontend",
          role: "code",
          state: "connected",
          path: "/workspace/frontend",
          connected: true,
          branch: "feature/status-output",
          branchMatches: false,
          remoteMatches: true,
          clean: false,
        }];
      },
    },
  });

  await cli.createProgram().parseAsync([
    "node",
    "openspec-orch",
    "repository",
    "status",
  ]);

  assert.deepEqual(output, [
    "✓ frontend [code] — подключён",
    "  Путь: /workspace/frontend",
    "  ✗ Ветка: feature/status-output — не совпадает с default_branch",
    "  ✓ Remote: совпадает",
    "  ⚠ Рабочее дерево: есть изменения",
  ]);
});
