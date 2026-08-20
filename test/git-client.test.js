import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createGitClient } from "../src/internal/shared/git-client.js";

test("GitClient owns porcelain parsing and pathspec construction", async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    return " M file with spaces\0R  renamed.txt\0original.txt\0";
  };
  const git = createGitClient("/project", runner);

  assert.deepEqual(
    await git.statusPaths(["openspec/config.yaml"]),
    ["file with spaces", "renamed.txt", "original.txt"],
  );
  assert.deepEqual(calls, [{
    command: "git",
    args: [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      "openspec/config.yaml",
    ],
    options: { cwd: "/project" },
  }]);
});

test("GitClient rejects malformed machine output", async () => {
  const malformedStatus = createGitClient("/project", async () => "invalid\0");
  await assert.rejects(malformedStatus.statusPaths(), /некорректный porcelain status/);

  const malformedDivergence = createGitClient("/project", async () => "one two");
  await assert.rejects(
    malformedDivergence.divergence("feature", "origin/feature"),
    /некорректный статус upstream/,
  );

  const malformedCount = createGitClient("/project", async () => "-1");
  await assert.rejects(malformedCount.countCommits("main..HEAD"), /некорректное число commit/);
});

test("GitClient returns structured refs, worktrees and divergence", async () => {
  const runner = async (_command, args) => {
    if (args[0] === "for-each-ref") return "refs/heads/main\nrefs/remotes/origin/main\n";
    if (args[0] === "worktree") return "worktree /project\nHEAD abc\n\nworktree /runtime/store\nHEAD def\n";
    if (args[0] === "rev-list") return "2\t3";
    throw new Error(`Unexpected Git call: ${args.join(" ")}`);
  };
  const git = createGitClient("/project", runner);

  assert.deepEqual(
    await git.refs(["refs/heads", "refs/remotes/origin"]),
    new Set(["refs/heads/main", "refs/remotes/origin/main"]),
  );
  assert.deepEqual(
    await git.worktreePaths(),
    new Set([path.resolve("/project"), path.resolve("/runtime/store")]),
  );
  assert.deepEqual(
    await git.divergence("feature", "origin/feature"),
    { localOnly: 2, remoteOnly: 3 },
  );
});
