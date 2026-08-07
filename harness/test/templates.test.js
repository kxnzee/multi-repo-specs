/** @fileoverview Проверка project rules и устанавливаемых агентских команд. */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Читает UTF-8 файл относительно корня Harness.
 *
 * @param {string} relativePath Относительный путь файла.
 * @returns {Promise<string>} Содержимое файла.
 */
async function read(relativePath) {
  return fs.readFile(path.join(HARNESS_ROOT, relativePath), "utf8");
}

test("OpenSpec использует встроенную схему и только дополнительные правила SDD", async () => {
  const contents = await read("init/skeleton/openspec/config.yaml");
  const config = parseYaml(contents);

  assert.equal(config.schema, "spec-driven");
  assert.deepEqual(Object.keys(config.rules).sort(), ["design", "proposal", "specs", "tasks"]);
  assert.match(config.context, /центральном Store Repository/);
  assert.match(config.rules.proposal.join("\n"), /Jira\/SberTrack key/);
  assert.match(config.rules.proposal.join("\n"), /repository-id/);
  assert.match(config.rules.specs.join("\n"), /межрепозиторный контракт/);
  assert.match(config.rules.design.join("\n"), /обязателен для каждого Change/);
  assert.match(config.rules.design.join("\n"), /стратегию отката/);
  assert.match(config.rules.tasks.join("\n"), /composite verification/);

  await assert.rejects(
    fs.stat(
      path.join(HARNESS_ROOT, "init/skeleton/openspec/schemas/multi-repo-sdd/schema.yaml"),
    ),
    /ENOENT/,
  );
});

test("сформированные команды SDD требуют валидацию и подтверждения для Archive", async () => {
  const [apply, verify] = await Promise.all([
    read("init/commands/sdd-apply.md"),
    read("init/commands/sdd-verify.md"),
  ]);

  assert.match(apply, /строгой OpenSpec-валидации/);
  assert.match(verify, /archive_readiness: ready/);
  assert.match(verify, /archive_readiness: blocked/);
  assert.match(verify, /не принимай финальное решение `Verified` от имени QA/);
  assert.doesNotMatch(verify, /verification\.md|delivery\.md/);
});
