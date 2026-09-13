/** @fileoverview Сравнение read-only Git facade: реальные commits, имена файлов и границы истории. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execa } from "execa";
import { RepositoryGit } from "../internal/git.js";

/** Изолированный Repository; никакой настройки Git пользователя. */
async function repository(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-git-changes-"));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = async (args) => (await execa("git", args, { cwd: root })).stdout;
  await run(["init", "-b", "main"]);
  await run(["config", "user.name", "Test"]);
  await run(["config", "user.email", "test@example.test"]);
  const git = new RepositoryGit({ root }, { cwd: root, async run(executable, args, { acceptedExitCodes = [0] } = {}) {
    const result = await execa(executable, args, { cwd: root, reject: false });
    if (!acceptedExitCodes.includes(result.exitCode)) throw new Error(result.stderr);
    return result.stdout;
  } });
  return { root, run, git };
}

test("changesSince separates net committed changes from staged, unstaged and untracked paths without writes", async (t) => {
  const { root, run, git } = await repository(t);
  for (const file of ["rename.txt", "delete.txt", "binary.dat"]) await fs.writeFile(path.join(root, file), "original");
  await run(["add", "."]);
  await run(["commit", "-m", "Base"]);
  const base = await git.revision();
  await run(["mv", "rename.txt", "переименован файл.txt"]);
  await run(["rm", "delete.txt"]);
  await fs.writeFile(path.join(root, "binary.dat"), new Uint8Array([0, 1, 2]));
  await run(["add", "."]);
  await run(["commit", "-m", "Change files"]);
  await fs.writeFile(path.join(root, "staged.txt"), "staged");
  await run(["add", "staged.txt"]);
  await fs.appendFile(path.join(root, "binary.dat"), "unstaged");
  await fs.writeFile(path.join(root, "untracked.txt"), "new");
  const before = await run(["status", "--porcelain=v1", "-z"]);
  const report = await git.changesSince(base);
  assert.equal(report.commit_count, 1);
  assert.deepEqual(report.committed_files, ["binary.dat", "delete.txt", "rename.txt", "переименован файл.txt"]);
  assert.deepEqual(report.worktree_files, ["binary.dat", "staged.txt", "untracked.txt"]);
  assert.equal(await git.revision(), report.to_revision);
  assert.equal(await run(["status", "--porcelain=v1", "-z"]), before);
  const same = await git.changesSince(report.to_revision);
  assert.equal(same.commit_count, 0);
  assert.deepEqual(same.committed_files, []);
  await assert.rejects(git.changesSince("HEAD"), /GIT_REVISION_INVALID/);
  await assert.rejects(git.changesSince("f".repeat(40)), /GIT_COMMIT_MISSING/);
  await run(["add", "."]);
  await run(["commit", "-m", "Preserve local work"]);
  await run(["checkout", "-b", "other", base]);
  await assert.rejects(git.changesSince(report.to_revision), /GIT_HISTORY_DIVERGED/);
});

test("changesSince rejects a HEAD that changed while reading instead of returning a mixed comparison", async (t) => {
  const { root, git, run } = await repository(t);
  await run(["commit", "--allow-empty", "-m", "Base"]);
  const base = await git.revision();
  const concurrent = new RepositoryGit({ root }, { cwd: root, async run(executable, args) {
    const output = await run(args);
    if (args[0] === "status") await run(["commit", "--allow-empty", "-m", "Concurrent commit"]);
    return output;
  } });
  await assert.rejects(concurrent.changesSince(base), /GIT_HEAD_CHANGED/);
});
