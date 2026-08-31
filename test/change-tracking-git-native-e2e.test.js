/** @fileoverview Git-native Change Tracking collaboration through the public CLI. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { stringify } from "yaml";

import { configuration, createProject } from "@openspec-orch/core";

import {
  commitFiles,
  configureGit,
  createBareRemote,
  initializeGitRepository,
  runCommand,
  temporaryDirectory,
  writeFiles,
} from "../test-fixtures/workspace.js";

const CLI_PATH = process.env.OPENSPEC_ORCH_TEST_CLI_PATH ??
  fileURLToPath(new URL("../bin/openspec-orch.js", import.meta.url));

test.before(async () => {
  const expected = process.env.OPENSPEC_ORCH_TEST_OPENSPEC_VERSION;
  if (!expected) return;
  const actual = (await execa("openspec", ["--version"])).stdout.trim();
  assert.equal(actual, expected, "Change Tracking smoke uses an unexpected OpenSpec version");
});

/** Runs the public distribution with machine-local OpenSpec registration. */
function runCli(machine, cwd, ...args) {
  return execa(process.execPath, [CLI_PATH, ...args], {
    cwd,
    env: machine.env,
    input: "y\n",
    timeout: 15_000,
  });
}

/** Explicitly updates one participant's local Store before read-only commands. */
function updateStore(machine) {
  return execa("git", ["pull", "--ff-only", "origin", "main"], {
    cwd: machine.store,
    env: machine.env,
  });
}

/** Creates one independent Store/code workspace and OpenSpec registry. */
async function cloneMachine(root, name, storeRemote, codeRemotes) {
  const workspace = path.join(root, name);
  const store = path.join(workspace, "specs");
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await runCommand("git", ["-c", "protocol.ext.allow=always", "clone", storeRemote, store]);
  await configureGit(store);
  await runCommand("git", ["-C", store, "config", "protocol.ext.allow", "always"]);
  const repositories = {};
  for (const [repositoryId, remote] of Object.entries(codeRemotes)) {
    const checkout = path.join(workspace, "src", repositoryId);
    await runCommand("git", ["-c", "protocol.ext.allow=always", "clone", remote, checkout]);
    await configureGit(checkout);
    await runCommand("git", ["-C", checkout, "config", "protocol.ext.allow", "always"]);
    repositories[repositoryId] = checkout;
  }
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(workspace, "xdg-config"),
    XDG_DATA_HOME: path.join(workspace, "xdg-data"),
  };
  await execa(
    "openspec",
    ["store", "register", store, "--id", "specs", "--yes", "--json"],
    { cwd: store, env },
  );
  return Object.freeze({ env, repositories: Object.freeze(repositories), store, workspace });
}

/** Builds a shared bare Store and two independent participant workspaces. */
async function collaborationFixture(t) {
  const root = await temporaryDirectory(t, "openspec-orch-git-native-tracking-");
  const frontendRemotePath = await createBareRemote(root, "frontend", {
    "README.md": "frontend\n",
    "openspec/config.yaml": "store: specs\n",
  });
  const backendRemotePath = await createBareRemote(root, "backend", {
    "README.md": "backend\n",
    "openspec/config.yaml": "store: specs\n",
  });
  const storeSource = path.join(root, "store-source");
  const storeRemotePath = path.join(root, "specs.git");
  const storeRemote = `ext::%S ${storeRemotePath}`;
  const frontendRemote = `ext::%S ${frontendRemotePath}`;
  const backendRemote = `ext::%S ${backendRemotePath}`;
  await initializeGitRepository(storeSource);
  const project = createProject({
    version: 2,
    strict: true,
    template: { id: "base" },
    agent: { id: "qwen" },
    extensions: [],
    plugins: [{
      id: "change-tracking",
      source: "@openspec-orch/plugin-change-tracking@1.0.0",
    }],
    repositories: [
      {
        id: "specs",
        role: "store",
        remote: storeRemote,
        defaultBranch: "main",
        plugins: ["change-tracking"],
      },
      {
        id: "frontend",
        role: "code",
        remote: frontendRemote,
        defaultBranch: "main",
        plugins: ["change-tracking"],
      },
      {
        id: "backend",
        role: "code",
        remote: backendRemote,
        defaultBranch: "main",
        plugins: ["change-tracking"],
      },
    ],
  });
  await writeFiles(storeSource, {
    ".openspec-store/store.yaml": stringify({
      version: 1,
      id: "specs",
      remote: storeRemote,
    }),
    "openspec/config.yaml": "schema: spec-driven\n",
    "openspec-orch.yaml": configuration.serializeProject(project),
    "openspec/changes/checkout-flow/proposal.md": [
      "## Repository Impact",
      "",
      "| Repository | Capabilities |",
      "| --- | --- |",
      "| `frontend` | `checkout/ui` |",
      "| `backend` | `checkout/api` |",
      "",
    ].join("\n"),
    "openspec/changes/checkout-flow/design.md": "# Design\n",
    "openspec/changes/checkout-flow/specs/checkout/spec.md": "# Checkout spec\n",
    "openspec/changes/checkout-flow/tasks.md": "# Tasks\n",
    "openspec/changes/profile-redesign/proposal.md": "# Profile redesign\n",
    "openspec/changes/profile-redesign/design.md": "# Design\n",
    "openspec/changes/profile-redesign/specs/profile/spec.md": "# Profile spec\n",
    "openspec/changes/profile-redesign/tasks.md": "# Tasks\n",
  });
  await commitFiles(storeSource, {}, { message: "plan checkout flow" });
  await runCommand("git", ["clone", "--bare", storeSource, storeRemotePath]);
  const remotes = { frontend: frontendRemote, backend: backendRemote };
  const alice = await cloneMachine(root, "alice", storeRemote, remotes);
  const bob = await cloneMachine(root, "bob", storeRemote, remotes);
  return Object.freeze({ alice, bob, root, storeRemote });
}

test("track publishes one Git-native Cycle that another machine can read", async (t) => {
  const { alice, bob } = await collaborationFixture(t);

  await runCli(alice, alice.store, "track", "checkout-flow");
  await updateStore(bob);
  const remoteStatus = await runCli(bob, bob.store, "status", "--json");
  const summary = JSON.parse(remoteStatus.stdout);
  const [status, untracked] = summary.changes;
  const humanSummary = (await runCli(bob, bob.store, "status")).stdout;
  const repeated = await runCli(alice, alice.store, "track", "checkout-flow");
  const repeatedStatus = JSON.parse((await runCli(
    bob,
    bob.store,
    "status", "checkout-flow", "--json",
  )).stdout);

  assert.equal(status.change_id, "checkout-flow");
  assert.equal(status.tracked, true);
  assert.equal(status.release_ready, false);
  assert.deepEqual(status.repositories, ["frontend", "backend"]);
  assert.deepEqual(untracked, {
    change_id: "profile-redesign",
    tracked: false,
  });
  assert.match(humanSummary, /Активные изменения \(2\)/u);
  assert.match(humanSummary, /• profile-redesign/u);
  assert.match(humanSummary, /Отслеживание ещё не начато/u);
  assert.match(humanSummary, /openspec-orch track profile-redesign/u);
  assert.equal(repeatedStatus.cycle_id, status.cycle_id);
  assert.match(repeated.stdout, /Сбор evidence уже настроен/u);
  assert.equal(
    await fs.readFile(
      path.join(bob.store, "tracking/cycles/checkout-flow/cycle.yaml"),
      "utf8",
    ).then((source) => source.includes("change_id: checkout-flow")),
    true,
  );
  assert.match(
    await runCommand("git", ["-C", bob.store, "log", "-1", "--pretty=%s"]),
    /tracking\(checkout-flow\): track/u,
  );
});

test("--no-push keeps the tracking commit local", async (t) => {
  const { alice, bob } = await collaborationFixture(t);

  await runCli(alice, alice.store, "track", "checkout-flow", "--no-push");
  assert.match(
    await runCommand("git", ["-C", alice.store, "log", "-1", "--pretty=%s"]),
    /tracking\(checkout-flow\): track/u,
  );
  await assert.rejects(
    runCli(bob, bob.store, "status", "checkout-flow", "--json"),
    (error) => error.exitCode === 1 && /CYCLE_NOT_FOUND/u.test(error.stderr),
  );
});

test("done publishes one append-only repository receipt visible on another machine", async (t) => {
  const { alice, bob } = await collaborationFixture(t);
  await runCli(alice, alice.store, "track", "checkout-flow");

  await runCli(alice, alice.repositories.frontend, "done");
  await updateStore(bob);
  const remoteStatus = JSON.parse((await runCli(
    bob,
    bob.store,
    "status", "checkout-flow", "--json",
  )).stdout);

  assert.deepEqual(
    remoteStatus.results.map(({ repository_id: id, implementation_revision: revision }) => ({
      id,
      submitted: revision !== null,
    })),
    [
      { id: "frontend", submitted: true },
      { id: "backend", submitted: false },
    ],
  );
  const receiptSource = await fs.readFile(
    path.join(
      bob.store,
      "tracking/cycles/checkout-flow/receipts/frontend.yaml",
    ),
    "utf8",
  );
  assert.match(receiptSource, /implementation_revision: [0-9a-f]{40}/u);
  assert.doesNotMatch(receiptSource, /\bstatus:/u);
  assert.match(receiptSource, /supersedes: null/u);
});

test("Snapshot is deterministic and a new receipt makes shared verification stale", async (t) => {
  const { alice, bob } = await collaborationFixture(t);
  await runCli(alice, alice.store, "track", "checkout-flow");
  await runCli(alice, alice.repositories.frontend, "done");
  await runCli(bob, bob.repositories.backend, "done");

  await updateStore(alice);
  const beforeVerification = JSON.parse((await runCli(
    alice,
    alice.store,
    "status", "checkout-flow", "--json",
  )).stdout);
  assert.equal(beforeVerification.snapshot.current, true);
  assert.equal(beforeVerification.verification, null);
  assert.equal(beforeVerification.release_ready, false);

  await runCli(bob, bob.store, "verify", "pass");
  await updateStore(alice);
  const verified = JSON.parse((await runCli(
    alice,
    alice.store,
    "status", "checkout-flow", "--json",
  )).stdout);
  assert.equal(verified.snapshot.snapshot_id, beforeVerification.snapshot.snapshot_id);
  assert.equal(verified.verification.result, "pass");
  assert.equal(verified.verification.current, true);
  assert.equal(verified.release_ready, true);
  assert.match(
    (await runCli(alice, alice.store, "status")).stdout,
    /Выпуск: готово к решению о выпуске/u,
  );

  await runCli(alice, alice.repositories.frontend, "done");
  await updateStore(bob);
  const changed = JSON.parse((await runCli(
    bob,
    bob.store,
    "status", "checkout-flow", "--json",
  )).stdout);
  assert.notEqual(changed.snapshot.snapshot_id, verified.snapshot.snapshot_id);
  assert.equal(changed.verification.result, "pass");
  assert.equal(changed.verification.current, false);
  assert.equal(changed.release_ready, false);

  const receiptSource = await fs.readFile(
    path.join(alice.store, "tracking/cycles/checkout-flow/receipts/frontend.yaml"),
    "utf8",
  );
  assert.equal((receiptSource.match(/receipt_id:/gu) ?? []).length, 2);
  assert.match(receiptSource, /supersedes: result-/u);
  await fs.access(path.join(
    alice.store,
    "tracking/cycles/checkout-flow/verification",
    `${verified.snapshot.snapshot_id}.yaml`,
  ));
});
