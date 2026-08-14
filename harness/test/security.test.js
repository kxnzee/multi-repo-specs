/** @fileoverview Проверки защиты управляемых конфигураций от symlink. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initProject } from "../init/index.js";

/**
 * Создаёт временный каталог и регистрирует его удаление.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @returns {Promise<string>} Временный каталог.
 */
async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openspec-orchestrator-security-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("initProject blocks a Store metadata symlink", async (t) => {
  const directory = await temporaryDirectory(t);
  const metadataDirectory = path.join(directory, ".openspec-store");
  const external = path.join(directory, "external-store.yaml");
  await fs.mkdir(metadataDirectory);
  await fs.writeFile(external, "version: 1\nid: payments-specs\n");
  await fs.symlink(external, path.join(metadataDirectory, "store.yaml"));

  await assert.rejects(
    initProject({ target: directory, storeId: "payments-specs", agentId: "qwen" }),
  );
  assert.equal(await fs.readFile(external, "utf8"), "version: 1\nid: payments-specs\n");
});
