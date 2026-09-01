/** @fileoverview Проверки Repository-scoped infrastructure facades нового Core. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  createRepository,
  createRepositoryCheckout,
  FileService,
  GitService,
  OpenSpecService,
  ProcessService,
  RepositoryCheckout,
  Workspace,
} from "@openspec-orch/core";

import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Создаёт изолированный RepositoryCheckout fixture. */
async function checkoutFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-facades-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repository = createRepository({
    id: "frontend",
    role: "code",
    remote: "https://example.test/frontend.git",
    defaultBranch: "main",
    plugins: [],
  });
  return { root, repository, checkout: createRepositoryCheckout(repository, root) };
}

test("ProcessService binds execution to Repository checkout and ignores caller cwd", async (t) => {
  const { root, checkout } = await checkoutFixture(t);
  const calls = [];
  const warnings = [];
  const service = new ProcessService(async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { failed: false, stderr: "warning", stdout: "done" };
  });

  assert.equal(checkout instanceof RepositoryCheckout, true);
  const result = await service.forRepository(checkout).run("tool", ["status"], {
    cwd: "/untrusted",
    environment: { TEAM: "payments" },
    onStderr: (message) => warnings.push(message),
  });

  assert.equal(result, "done");
  assert.equal(calls[0].options.cwd, root);
  assert.equal(calls[0].options.env.TEAM, "payments");
  assert.equal(calls[0].options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(calls[0].options.stdin, "ignore");
  assert.deepEqual(warnings, ["warning"]);
  await assert.rejects(service.forRepository(checkout).run("tool", [], { timeout: 0 }), /Timeout/);
});

test("ProcessService closes stdin for non-interactive external commands", async (t) => {
  const { checkout } = await checkoutFixture(t);
  const output = await new ProcessService().forRepository(checkout).run(
    process.execPath,
    [
      "--eval",
      "process.stdin.once('end', () => process.stdout.write('stdin closed')); process.stdin.resume();",
    ],
    { timeout: 1_000 },
  );

  assert.equal(output, "stdin closed");
});

test("ProcessService redacts sensitive values from failed invocation and output", async (t) => {
  const { checkout } = await checkoutFixture(t);
  const secret = "https://token@example.test/private.git";
  const service = new ProcessService(async () => ({
    failed: true,
    timedOut: false,
    signal: undefined,
    exitCode: 1,
    stderr: `fatal: ${secret}`,
    stdout: "",
  }));

  await assert.rejects(
    service.forRepository(checkout).run("git", ["clone", secret], { sensitiveValues: [secret] }),
    (error) => !error.message.includes(secret) && error.message.includes("<repository-url>"),
  );
});

test("ProcessService returns output for an explicitly accepted nonzero exit code", async (t) => {
  const { checkout } = await checkoutFixture(t);
  const service = new ProcessService(async () => ({
    failed: true,
    exitCode: 1,
    stderr: "",
    stdout: "partial result",
  }));

  assert.equal(
    await service.forRepository(checkout).run("tool", ["status"], {
      acceptedExitCodes: [0, 1],
    }),
    "partial result",
  );
});

test("GitService exposes domain operations without accepting arbitrary cwd", async (t) => {
  const { root, repository, checkout } = await checkoutFixture(t);
  const calls = [];
  const processService = new ProcessService(async (executable, args, options) => {
    calls.push({ executable, args, options });
    const stdout = args[0] === "status"
      ? " M file.js\0R  renamed.js\0old.js\0"
      : args[0] === "log" ? "b".repeat(40)
      : args[0] === "rev-parse" && args[1] === "--git-path"
        ? `.git/${args[2]}`
      : args.includes("--show-toplevel") ? root : "main";
    return {
      failed: args[0] === "status" && args.includes("--all"),
      exitCode: args[0] === "status" && args.includes("--all") ? 1 : 0,
      stderr: "",
      stdout,
    };
  });
  const service = new GitService(processService);
  const repositoryGit = service.forRepository(checkout);

  assert.equal(await repositoryGit.repositoryRoot(), root);
  assert.equal(await repositoryGit.currentBranch(), "main");
  assert.deepEqual(await repositoryGit.statusPaths(), ["file.js", "renamed.js", "old.js"]);
  assert.equal(await repositoryGit.isClean(["README.md"]), false);
  assert.equal(
    await repositoryGit.latestRevision(["openspec/changes/checkout-flow"]),
    "b".repeat(40),
  );
  assert.throws(() => repositoryGit.latestRevision([]), /GIT_PATHSPEC_INVALID/u);
  assert.equal(await repositoryGit.isRemoteReachable("a".repeat(40)), true);
  assert.equal(await repositoryGit.hasCommit("a".repeat(40)), true);
  await repositoryGit.assertNoOperation();
  await fs.mkdir(path.join(root, ".git"));
  await fs.writeFile(path.join(root, ".git", "MERGE_HEAD"), "revision\n", "utf8");
  await assert.rejects(repositoryGit.assertNoOperation(), /Git-операция \(MERGE_HEAD\)/);
  assert.equal(calls.every(({ executable }) => executable === "git"), true);
  assert.equal(calls.every(({ options }) => options.cwd === root), true);

  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-clone-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const workspace = new Workspace(workspaceRoot);
  const target = await service.forWorkspace(workspace).clone(repository);
  assert.equal(target, path.join(workspaceRoot, "src", "frontend"));
  assert.deepEqual(calls.at(-1).args.slice(0, 5), [
    "clone",
    "--single-branch",
    "--no-tags",
    "--branch",
    "main",
  ]);
});

test("OpenSpecService binds openspec execution to Repository checkout", async (t) => {
  const { root, checkout } = await checkoutFixture(t);
  const calls = [];
  const processService = new ProcessService(async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { failed: false, stderr: "", stdout: "{}" };
  });

  const repositoryOpenSpec = new OpenSpecService(processService).forRepository(checkout);

  assert.equal(
    await repositoryOpenSpec.execute(["context", "--json"]),
    "{}",
  );
  assert.deepEqual(calls[0], {
    executable: "openspec",
    args: ["context", "--json"],
    options: {
      cwd: root,
      env: { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      reject: false,
      stdin: "ignore",
      timeout: 120_000,
    },
  });
});

test("FileService reads and atomically writes only inside Repository checkout", async (t) => {
  const { root, checkout } = await checkoutFixture(t);
  const service = new FileService().forRepository(checkout);
  await fs.mkdir(path.join(root, "config"));
  await fs.writeFile(path.join(root, "config", "project.txt"), "before", "utf8");

  assert.equal(await service.read("config/project.txt"), "before");
  await service.write("config/project.txt", "after");
  assert.equal(await service.read("config/project.txt"), "after");
  await service.write("config/new.txt", "new");
  assert.equal(await service.read("config/new.txt"), "new");
  assert.equal(
    await service.update("config/new.txt", (current) => `${current} value`),
    "new value",
  );
  assert.equal(await service.read("config/new.txt"), "new value");
  assert.deepEqual(await service.listFiles("config"), ["new.txt", "project.txt"]);
  await fs.mkdir(path.join(root, "config", "alpha"));
  await fs.mkdir(path.join(root, "config", "zeta"));
  assert.deepEqual(await service.listDirectories("config"), ["alpha", "zeta"]);
  assert.deepEqual(await service.listDirectories("missing", { optional: true }), []);
  assert.deepEqual(await service.listFiles("missing", { optional: true }), []);
  assert.equal(await service.read("config/missing.txt", { optional: true }), null);
  await service.write("generated/nested/file.txt", "nested");
  assert.equal(await service.read("generated/nested/file.txt"), "nested");
  await assert.rejects(service.read("../outside.txt"), /Некорректный относительный путь/);
  await assert.rejects(
    service.read("config/missing.txt", { optional: "yes" }),
    /optional должен быть boolean/,
  );
  await assert.rejects(service.update("config/new.txt", null), /operation должен быть function/);
  await assert.rejects(service.update("config/new.txt", async () => null), /должен быть строкой/);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orch-core-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await createDirectoryLink(outside, path.join(root, "linked"));
  await assert.rejects(service.write("linked/file.txt", "blocked"), /symlink/);
  await createDirectoryLink(outside, path.join(root, "config", "linked"));
  await assert.rejects(service.listFiles("config"), /symlink/);
});
