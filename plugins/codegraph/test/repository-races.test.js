/** @fileoverview Deterministic filesystem race and compatibility checks for Git excludes. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CodeGraphRepository } from "../lib/repository.js";

const execute = promisify(execFile);

/** Creates one isolated Git checkout. */
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codegraph-race-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await execute("git", ["init", "--initial-branch=main"], { cwd: root });
  const target = path.join(root, ".git/info/exclude");
  await fs.writeFile(target, "original/\n");
  return { root, target, repository: new CodeGraphRepository(root) };
}

test("CodeGraph rejects replacement between exclude check and read without modifying it", async (t) => {
  const { target, repository } = await fixture(t);
  const original = fs.lstat.bind(fs);
  let replaced = false;
  t.mock.method(fs, "lstat", async (...args) => {
    const stat = await original(...args);
    if (args[0] === target && !replaced) {
      replaced = true;
      await fs.rename(target, `${target}.checked`);
      await fs.writeFile(target, "replacement/\n");
    }
    return stat;
  });
  await assert.rejects(repository.excludeGeneratedIndex(), /CODEGRAPH_GIT_EXCLUDE_UNSAFE/);
  assert.equal(replaced, true);
  assert.equal(await fs.readFile(target, "utf8"), "replacement/\n");
});

test("CodeGraph does not redirect append when a checked exclude becomes a hardlink", async (t) => {
  const { root, target, repository } = await fixture(t);
  const victim = path.join(root, "victim");
  await fs.writeFile(victim, "untouched\n");
  let replaced = false;
  const replace = async () => {
    if (replaced) return;
    replaced = true;
    await fs.rename(target, `${target}.checked`);
    await fs.link(victim, target);
  };
  const read = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", async (...args) => {
    const value = await read(...args);
    if (args[0] === target) await replace();
    return value;
  });
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === target) {
      const handleRead = handle.readFile.bind(handle);
      t.mock.method(handle, "readFile", async (...readArgs) => {
        const value = await handleRead(...readArgs);
        await replace();
        return value;
      });
    }
    return handle;
  });
  await assert.rejects(repository.excludeGeneratedIndex(), /CODEGRAPH_GIT_EXCLUDE_UNSAFE/);
  assert.equal(replaced, true);
  assert.equal(await fs.readFile(victim, "utf8"), "untouched\n");
});

test("CodeGraph existing marker requires no writable file handle", async (t) => {
  const { target, repository } = await fixture(t);
  await fs.writeFile(target, ".codegraph/\n");
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args) => {
    if (args[0] === target) {
      assert.equal(typeof args[1], "number");
      assert.equal(args[1] & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT), 0);
    }
    return open(...args);
  });
  await repository.excludeGeneratedIndex();
  assert.equal(await fs.readFile(target, "utf8"), ".codegraph/\n");
});

test("CodeGraph exclusive creation refuses a file introduced after ENOENT", async (t) => {
  const { root, target, repository } = await fixture(t);
  await fs.unlink(target);
  const victim = path.join(root, "victim");
  await fs.writeFile(victim, "untouched\n");
  const lstat = fs.lstat.bind(fs);
  let introduced = false;
  t.mock.method(fs, "lstat", async (...args) => {
    try { return await lstat(...args); } catch (error) {
      if (args[0] === target && error.code === "ENOENT" && !introduced) {
        introduced = true;
        await fs.link(victim, target);
      }
      throw error;
    }
  });
  await assert.rejects(repository.excludeGeneratedIndex(), /CODEGRAPH_GIT_EXCLUDE_UNSAFE/);
  assert.equal(introduced, true);
  assert.equal(await fs.readFile(victim, "utf8"), "untouched\n");
});

test("CodeGraph appends only to the verified handle if the path changes after open", async (t) => {
  const { root, target, repository } = await fixture(t);
  const victim = path.join(root, "victim");
  await fs.writeFile(victim, "untouched\n");
  const open = fs.open.bind(fs);
  const handles = [];
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    handles.push(handle);
    if (args[0] === target && (args[1] & constants.O_WRONLY)) {
      await fs.rename(target, `${target}.opened`);
      await fs.link(victim, target);
    }
    return handle;
  });
  await repository.excludeGeneratedIndex();
  assert.equal(await fs.readFile(victim, "utf8"), "untouched\n");
  assert.equal(await fs.readFile(`${target}.opened`, "utf8"), "original/\n.codegraph/\n");
  assert.equal(handles.length, 2);
  assert.ok(handles.every((handle) => handle.fd === -1));
});

test("CodeGraph closes read and append handles when append fails", async (t) => {
  const { target, repository } = await fixture(t);
  const cause = new Error("append failed");
  const open = fs.open.bind(fs);
  const handles = [];
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    handles.push(handle);
    if (args[0] === target && (args[1] & constants.O_WRONLY)) {
      t.mock.method(handle, "appendFile", async () => { throw cause; });
    }
    return handle;
  });
  await assert.rejects(repository.excludeGeneratedIndex(), (error) => error === cause);
  assert.ok(handles.every((handle) => handle.fd === -1));
  assert.equal(await fs.readFile(target, "utf8"), "original/\n");
});

test("CodeGraph preserves LF/no-final-newline and recreates absent Git info/exclude", async (t) => {
  const { target, repository } = await fixture(t);
  await fs.writeFile(target, "existing/");
  await repository.excludeGeneratedIndex();
  assert.equal(await fs.readFile(target, "utf8"), "existing/\n.codegraph/\n");
  await fs.rm(path.dirname(target), { recursive: true });
  await repository.excludeGeneratedIndex();
  await repository.excludeGeneratedIndex();
  assert.equal(await fs.readFile(target, "utf8"), ".codegraph/\n");
});

test("CodeGraph respects a linked worktree's Git metadata outside the worktree", async (t) => {
  const { root, target } = await fixture(t);
  await execute("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test",
    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"], { cwd: root });
  const worktree = path.join(root, "linked-worktree");
  await execute("git", ["worktree", "add", "-b", "linked", worktree], { cwd: root });
  await new CodeGraphRepository(worktree).excludeGeneratedIndex();
  assert.equal(await fs.readFile(target, "utf8"), "original/\n.codegraph/\n");
});
