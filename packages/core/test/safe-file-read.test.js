/** @fileoverview Verified-handle reads under deterministic path replacement. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readRegularFile } from "../internal/fs.js";
import { createDirectoryLink } from "../fixtures/filesystem.js";

/** Creates an isolated ordinary file. */
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "safe-file-read-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "manifest");
  await fs.writeFile(target, "original");
  return { root, target };
}

test("safe read consumes and closes the opened inode after its pathname is replaced", async (t) => {
  const { target } = await fixture(t);
  const open = fs.open.bind(fs);
  let opened;
  t.mock.method(fs, "open", async (...args) => {
    opened = await open(...args);
    await fs.rename(target, `${target}.opened`);
    await fs.writeFile(target, "replacement");
    return opened;
  });
  assert.equal(await readRegularFile(target), "original");
  assert.equal(opened.fd, -1);
  assert.equal(await fs.readFile(target, "utf8"), "replacement");
});

test("safe read rejects changed inode before consuming bytes and closes the handle", async (t) => {
  const { target } = await fixture(t);
  const open = fs.open.bind(fs);
  let opened;
  let read = false;
  t.mock.method(fs, "open", async (...args) => {
    await fs.rename(target, `${target}.checked`);
    await fs.writeFile(target, "replacement");
    opened = await open(...args);
    t.mock.method(opened, "readFile", async () => { read = true; return "replacement"; });
    return opened;
  });
  await assert.rejects(readRegularFile(target), /SAFE_PATH_INVALID/);
  assert.equal(read, false);
  assert.equal(opened.fd, -1);
});

test("safe read closes a handle on read failure and preserves the cause", async (t) => {
  const { target } = await fixture(t);
  const open = fs.open.bind(fs);
  const cause = new Error("read failed");
  let opened;
  t.mock.method(fs, "open", async (...args) => {
    opened = await open(...args);
    t.mock.method(opened, "readFile", async () => { throw cause; });
    return opened;
  });
  await assert.rejects(readRegularFile(target), (error) => error === cause);
  assert.equal(opened.fd, -1);
});

test("safe read rejects missing/non-file paths and preserves legitimate hardlink reads", async (t) => {
  const { root, target } = await fixture(t);
  await assert.rejects(readRegularFile(path.join(root, "missing")), { code: "ENOENT" });
  await assert.rejects(readRegularFile(root), /SAFE_PATH_INVALID/);
  const linkedDirectory = path.join(root, "linked-directory");
  const ordinaryDirectory = path.join(root, "directory");
  await fs.mkdir(ordinaryDirectory);
  await createDirectoryLink(ordinaryDirectory, linkedDirectory);
  await assert.rejects(readRegularFile(linkedDirectory), /SAFE_PATH_INVALID/);
  const hardlink = path.join(root, "hardlink");
  await fs.link(target, hardlink);
  assert.equal(await readRegularFile(hardlink), "original");
});
