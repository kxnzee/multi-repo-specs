/** @fileoverview Проверка безопасного merge OpenSpec config. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import { mergeOpenSpecConfig } from "../init/merge.js";

/**
 * Создаёт временный каталог и регистрирует его удаление.
 *
 * @param {import("node:test").TestContext} t Контекст теста.
 * @returns {Promise<string>} Временный каталог.
 */
async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-merge-"));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("mergeOpenSpecConfig preserves and extends custom rules", async (t) => {
  const directory = await temporaryDirectory(t);
  const source = path.join(directory, "template.yaml");
  const destination = path.join(directory, "config.yaml");
  await fs.writeFile(
    source,
    "schema: spec-driven\ncontext: required context\nrules:\n  custom:\n    - rule-b\n",
  );
  await fs.writeFile(
    destination,
    "schema: spec-driven\ncontext: user context\nrules:\n  custom:\n    - rule-a\n",
  );

  assert.equal(await mergeOpenSpecConfig(source, destination), true);
  const merged = parseYaml(await fs.readFile(destination, "utf8"));
  assert.deepEqual(merged.rules.custom, ["rule-a", "rule-b"]);
  assert.equal(merged.context.includes("user context"), true);
  assert.equal(merged.context.includes("required context"), true);
});

test("mergeOpenSpecConfig rejects a Store pointer", async (t) => {
  const directory = await temporaryDirectory(t);
  const source = path.join(directory, "template.yaml");
  const destination = path.join(directory, "config.yaml");
  await fs.writeFile(
    source,
    "schema: spec-driven\ncontext: required context\nrules:\n  custom:\n    - rule-b\n",
  );
  await fs.writeFile(destination, "store: test\n");

  await assert.rejects(
    mergeOpenSpecConfig(source, destination),
  );
});
