/** @fileoverview Команда установки воркспейса принадлежит только чекауту Orchestrator. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMMAND = "setup-workspace.md";

/** Возвращает все файлы каталога рекурсивно. */
async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

test("setup-workspace command exists for every supported agent checkout", async () => {
  const sources = [];
  for (const dir of [".claude", ".qwen", ".gigacode"]) {
    const source = await fs.readFile(path.join(ROOT, dir, "commands", COMMAND), "utf8");
    assert.match(source, /docs\/user\/agent-install\.md/u, dir);
    sources.push(source);
  }
  assert.equal(new Set(sources).size, 1, "command copies must stay identical");
});

test("setup-workspace command is not shipped to Stores, repositories or npm package", async () => {
  for (const dir of ["templates", "extensions"]) {
    const files = await listFiles(path.join(ROOT, dir));
    assert.deepEqual(files.filter((file) => path.basename(file) === COMMAND), [], dir);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  for (const entry of manifest.files) {
    assert.equal(/^\.(claude|qwen|gigacode)/u.test(entry), false, entry);
  }
});
