/** @fileoverview Distribution composition smoke for bundled Plugin packages. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { configuration, createProject } from "@openspec-orch/core";

import {
  commitFiles,
  createCheckoutWithRemote,
  runCommand,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const CLI_PATH = process.env.OPENSPEC_ORCH_TEST_CLI_PATH ??
  fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));

/** Запускает candidate CLI в изолированном Store. */
function runCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd });
}

/** Запускает подтверждаемую command через реальный stdin публичного CLI. */
function confirmCli(cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], { cwd, input: "y\n" });
}

/** Инициализирует реальный Git Repository для distribution smoke. */
async function initializeGitRepository(root) {
  await execa("git", ["init", "--initial-branch=main"], { cwd: root });
  await execa("git", ["add", "."], { cwd: root });
  await execa(
    "git",
    [
      "-c", "user.name=OpenSpec Orchestrator Test",
      "-c", "user.email=orchestrator@example.test",
      "commit", "-m", "Initial fixture",
    ],
    { cwd: root },
  );
}

test("candidate distribution initializes bundled Plugins and mounts trusted root commands", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-distribution-"));
  const storeRoot = path.join(workspaceRoot, "specs");
  const codeRoot = path.join(workspaceRoot, "src", "frontend");
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  await fs.mkdir(storeRoot);
  await fs.mkdir(codeRoot, { recursive: true });
  await fs.writeFile(path.join(codeRoot, "index.js"), "export const ready = true;\n");
  await fs.mkdir(path.join(storeRoot, ".openspec-store"));
  await fs.mkdir(path.join(storeRoot, "openspec"));
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: "https://example.test/specs.git",
        defaultBranch: "main",
        plugins: [],
      },
      {
        id: "frontend",
        role: "code",
        remote: "https://example.test/frontend.git",
        defaultBranch: "main",
        plugins: [],
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
  await initializeGitRepository(storeRoot);
  await initializeGitRepository(codeRoot);

  await runCli(storeRoot, "plugin", "init", "--plugin", "change-tracking");
  await runCli(storeRoot, "plugin", "init", "--plugin", "codegraph");
  await runCli(storeRoot, "plugin", "init", "--plugin", "openspec-graph");
  const { stdout } = await runCli(storeRoot, "--help");
  const graphHelp = await runCli(storeRoot, "graph", "--help");
  const configured = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );

  assert.deepEqual(configured.plugins, ["change-tracking", "codegraph", "openspec-graph"]);
  assert.match(graphHelp.stdout, /build/);
  assert.match(graphHelp.stdout, /status/);
  assert.match(graphHelp.stdout, /view/);
  assert.match(graphHelp.stdout, /check-scope/);
  assert.match(
    await fs.readFile(path.join(storeRoot, ".codex/config.toml"), "utf8"),
    /\[mcp_servers\."openspec-orch-codegraph"\]/,
  );
  assert.match(await fs.readFile(path.join(storeRoot, "AGENTS.md"), "utf8"), /codegraph_explore/);
  await runCli(
    storeRoot,
    "plugin", "connect", "codegraph", "--repo", "specs", "--repo", "frontend",
  );
  assert.equal((await execa(
    "git",
    ["status", "--short", "--untracked-files=all"],
    { cwd: codeRoot },
  )).stdout, "");
  await assert.rejects(fs.access(path.join(codeRoot, ".gitignore")));
  const status = await runCli(
    storeRoot,
    "plugin", "status", "--plugin", "codegraph", "--json",
  );
  assert.deepEqual(JSON.parse(status.stdout).plugins.map(({ pluginId, repositoryId, state }) => ({
    pluginId,
    repositoryId,
    state,
  })), [
    { pluginId: "codegraph", repositoryId: "specs", state: "stale" },
    { pluginId: "codegraph", repositoryId: "frontend", state: "ready" },
  ]);
  const humanStatus = await runCli(storeRoot, "plugin", "status", "--plugin", "codegraph");
  assert.match(humanStatus.stdout, /⚠ codegraph → specs — требует обновления/);
  assert.match(humanStatus.stdout, /✓ codegraph → frontend — готов/);
  assert.doesNotMatch(humanStatus.stdout, /^\s*\{/mu);
  const syncAll = await runCli(storeRoot, "plugin", "sync", "codegraph", "--all");
  assert.match(syncAll.stdout, /✓ codegraph → specs — синхронизирован/);
  assert.match(syncAll.stdout, /✓ codegraph → frontend — синхронизирован/);
  assert.match(syncAll.stdout, /✓ codegraph → specs — готов/);
  assert.match(syncAll.stdout, /✓ codegraph → frontend — готов/);
  const execAll = await runCli(
    storeRoot,
    "plugin", "exec", "codegraph", "--all", "--", "status", "--json",
  );
  assert.match(execAll.stdout, /✓ codegraph → specs — команда выполнена/);
  assert.match(execAll.stdout, /✓ codegraph → frontend — команда выполнена/);
  for (const command of ["assign", "status", "record", "verify"]) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`));
  }
  assert.doesNotMatch(stdout, /change-tracking\s+Команды Plugin/);

  const disconnectAll = await runCli(storeRoot, "plugin", "disconnect", "codegraph", "--all");
  assert.match(disconnectAll.stdout, /✓ codegraph → specs — отключён/);
  assert.match(disconnectAll.stdout, /✓ codegraph → frontend — отключён/);
  await runCli(storeRoot, "plugin", "remove", "codegraph");
  const removed = configuration.parseProject(
    await fs.readFile(path.join(storeRoot, "openspec-orch.yaml"), "utf8"),
  );
  assert.deepEqual(removed.plugins, ["change-tracking", "openspec-graph"]);
  assert.doesNotMatch(
    await fs.readFile(path.join(storeRoot, ".codex/config.toml"), "utf8"),
    /openspec-orch-codegraph/,
  );
  assert.doesNotMatch(await fs.readFile(path.join(storeRoot, "AGENTS.md"), "utf8"), /codegraph_explore/);
});

test("candidate distribution completes Change Tracking through the public CLI", async (t) => {
  const root = await temporaryDirectory(t, "openspec-orch-distribution-cycle-");
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
  const repository = ({ id, role, remote }) => ({
    id,
    role,
    remote,
    defaultBranch: "main",
    plugins: [],
  });
  const project = createProject({
    version: 3,
    strict: true,
    agents: ["codex"],
    plugins: [],
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
  await commitFiles(store.checkout, {}, { message: "configure distribution Store" });

  await runCli(store.checkout, "plugin", "init", "--plugin", "change-tracking");
  await runCli(
    store.checkout,
    "plugin", "connect", "change-tracking",
    "--repo", "specs", "--repo", "frontend", "--repo", "backend",
  );
  await runCommand("git", ["-C", store.checkout, "add", "openspec-orch.yaml"]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "enable change tracking"]);

  await confirmCli(
    store.checkout,
    "assign", "checkout-flow", "--repo", "frontend", "--repo", "backend",
  );
  const cyclePath = ".openspec-orch/changes/Y2hlY2tvdXQtZmxvdw.json";
  await runCommand("git", ["-C", store.checkout, "add", cyclePath]);
  await runCommand("git", ["-C", store.checkout, "commit", "-m", "assign checkout flow"]);

  await assert.rejects(
    runCli(store.checkout, "verify", "checkout-flow"),
    (error) => error.exitCode === 1 && /CYCLE_MISMATCH/.test(error.stderr),
  );
  await assert.rejects(
    runCli(
      store.checkout,
      "record", "assignment", "checkout-flow",
      "--repo", "frontend", "--commit", "0000000000000000000000000000000000000000",
      "--status", "completed", "--source", "agent",
    ),
    (error) => error.exitCode === 1 && /COMMIT_NOT_FOUND/.test(error.stderr),
  );

  for (const [repositoryId, checkout] of [
    ["frontend", frontend.checkout],
    ["backend", backend.checkout],
  ]) {
    const revision = await runCommand("git", ["-C", checkout, "rev-parse", "HEAD"]);
    await confirmCli(
      store.checkout,
      "record", "assignment", "checkout-flow",
      "--repo", repositoryId, "--commit", revision,
      "--status", "completed", "--source", "agent",
    );
  }
  const verified = await runCli(store.checkout, "verify", "checkout-flow");
  assert.match(verified.stdout, /snapshot_id: snap-v1-/);
  await confirmCli(
    store.checkout,
    "record", "verification", "checkout-flow", "--result", "pass", "--source", "human",
  );
  const status = JSON.parse((await runCli(
    store.checkout,
    "status", "checkout-flow", "--json",
  )).stdout);
  const execStatus = JSON.parse((await runCli(
    store.checkout,
    "plugin", "exec", "change-tracking", "--repo", "specs", "--",
    "status", "checkout-flow", "--json",
  )).stdout);

  assert.equal(status.next_action, "готово");
  assert.equal(execStatus.current_repository, null);
  assert.equal(execStatus.change_id, status.change_id);
  assert.equal(execStatus.cycle_id, status.cycle_id);
  assert.deepEqual(execStatus.results, status.results);
  assert.deepEqual(execStatus.snapshot, status.snapshot);
  assert.deepEqual(execStatus.verification, status.verification);
  assert.equal(status.verification.result, "pass");
  assert.deepEqual(status.results.map(({ repository_id: id, status: state }) => ({ id, state })), [
    { id: "frontend", state: "completed" },
    { id: "backend", state: "completed" },
  ]);
});
