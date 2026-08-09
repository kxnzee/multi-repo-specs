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
  const [contents, step00] = await Promise.all([
    read("init/skeleton/openspec/config.yaml"),
    read("../docs/steps/00.md"),
  ]);
  const config = parseYaml(contents);

  assert.equal(config.schema, "spec-driven");
  assert.deepEqual(Object.keys(config.rules).sort(), ["design", "proposal", "specs", "tasks"]);
  assert.match(config.context, /центральном Store Repository/);
  assert.match(config.context, /Не требуй knowledge_path/);
  assert.match(config.context, /родитель agent\.commands_directory/);
  assert.match(config.context, /делегируй native subagents отдельный read-only Repository Context Pass/);
  assert.match(config.context, /один repository-id и один конкретный вопрос/);
  assert.match(config.context, /change-id,[\s\S]*целевой artifactId, repository-id, checkout, точную ревизию/);
  assert.match(config.context, /repository_id, revision, question, status/);
  assert.match(config.context, /facts, system_impact, verification_implications, confidence, open_questions/);
  assert.match(config.context, /evidence в формате file:line/);
  assert.match(config.context, /Единственный основной агент/);
  assert.match(config.rules.proposal.join("\n"), /Jira\/SberTrack key/);
  assert.match(config.rules.proposal.join("\n"), /repository-id/);
  assert.match(config.rules.proposal.join("\n"), /Code Repositories, известные по итогам Explore как кандидаты/);
  assert.match(config.rules.proposal.join("\n"), /окончательный технический impact.*design.md/);
  assert.match(config.rules.specs.join("\n"), /межрепозиторный контракт/);
  assert.match(config.rules.specs.join("\n"), /классы.*хуки/);
  assert.match(config.rules.design.join("\n"), /обязателен для каждого Change/);
  assert.match(config.rules.design.join("\n"), /только межсистемный уровень/);
  assert.match(config.rules.design.join("\n"), /окончательный технический impact.*точным ревизиям/);
  assert.match(config.rules.design.join("\n"), /Repository Knowledge Pack/);
  assert.match(config.rules.design.join("\n"), /не блокируют Change/);
  assert.match(config.rules.design.join("\n"), /блокирующим только конкретный неразрешённый факт/);
  assert.match(config.rules.design.join("\n"), /никогда не загружай репозиторий целиком/);
  assert.match(config.rules.design.join("\n"), /При Repository Context Pass/);
  assert.match(config.rules.design.join("\n"), /Считай репозитории Proposal кандидатами/);
  assert.match(config.rules.design.join("\n"), /чистым checkout того же Store/);
  assert.match(config.rules.design.join("\n"), /без возврата в Explore/);
  assert.match(config.rules.design.join("\n"), /стратегию отката/);
  assert.match(config.rules.tasks.join("\n"), /composite verification/);
  assert.match(config.rules.tasks.join("\n"), /стандартным checkbox tasks\.md/);
  assert.match(config.rules.tasks.join("\n"), /task\.id из структурированного ответа openspec instructions apply/);
  assert.match(config.rules.tasks.join("\n"), /store, конкретный repository-id либо composite-verification/);
  assert.match(config.rules.tasks.join("\n"), /не создавай собственный формат ID/);
  assert.match(config.rules.tasks.join("\n"), /implementation PR Code Repository/);
  assert.match(config.rules.tasks.join("\n"), /обновление Repository Knowledge Pack/);
  assert.match(config.rules.tasks.join("\n"), /окончательного технического impact design.md/);

  const configSection = step00.indexOf("### Конфигурация OpenSpec");
  const fenceMarker = "```yaml\n";
  const fenceStart = step00.indexOf(fenceMarker, configSection);
  const fenceEnd = step00.indexOf("\n```", fenceStart + fenceMarker.length);
  assert.notEqual(configSection, -1);
  assert.notEqual(fenceStart, -1);
  assert.notEqual(fenceEnd, -1);
  assert.equal(
    step00.slice(fenceStart + fenceMarker.length, fenceEnd).trimEnd(),
    contents.trimEnd(),
  );

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

  assert.match(apply, /openspec validate <change-id> --type change --strict --no-interactive --json/);
  assert.match(apply, /<repository-id>\/context\.json/);
  assert.match(apply, /`openspec instructions apply --change <change-id> --json`/);
  assert.match(apply, /--store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>\.\.\./);
  assert.match(apply, /готовым первым сообщением `next_action`/);
  assert.match(apply, /Используй тот же набор значений, который был передан в успешный `sdd load`/);
  assert.match(apply, /не вычисляй Store, repository, Baseline или Work Packages автоматически/);
  assert.doesNotMatch(apply, /sdd open|sdd instructions apply|digest Work Package/);
  assert.match(verify, /archive_readiness: ready/);
  assert.match(verify, /archive_readiness: blocked/);
  assert.match(verify, /не принимай финальное решение `Verified` от имени QA/);
  assert.doesNotMatch(verify, /verification\.md|delivery\.md/);
});

test("инструкции агентов направляют завершённый Planning на шаг 04", async () => {
  const instructions = await Promise.all([
    read("init/agents/qwen/QWEN.md"),
    read("init/agents/gigacode/GIGACODE.md"),
  ]);

  for (const contents of instructions) {
    assert.match(contents, /раздел намеренно находится в файле инструкций агента/);
    assert.match(contents, /built-in `\/opsx-continue`/);
    assert.match(contents, /`isComplete: true`.*до вызова `openspec instructions`/s);
    assert.match(contents, /Правила содержимого Proposal, Specs, Design[\s\S]*остаются в `openspec\/config.yaml`/);
    assert.match(contents, /`isComplete: true`.*только завершение Proposal, Specs, Design и Tasks/);
    assert.match(contents, /следующий этап — шаг 04, Planning PR и фиксация Spec Baseline/);
    assert.match(contents, /Не предлагай и не запускай `\/opsx-apply`/);
    assert.match(contents, /Не предлагай и не запускай `\/opsx-archive` до шага 09/);
    assert.match(contents, /`archive_readiness: ready`/);
    assert.match(contents, /backend, frontend, Composite Verification и ручная проверка/);
    assert.match(contents, /подсказку built-in `\/opsx-continue`.*замени маршрутом на шаг 04/);
    assert.match(contents, /Не предлагай отдельные `sdd review`, `sdd baseline`/);
    assert.match(contents, /Не считай HEAD ветки `feature\/<change-id>` Spec Baseline/);
    assert.match(contents, /Baseline появляется только после merge Planning PR/);
    assert.match(contents, /`\/opsx-update <change-id>`.*только.*unresolved comments/s);
    assert.match(contents, /точный текст замечаний.*threads либо `file:line`/);
    assert.match(contents, /Не закрывай review threads, не создавай commit, не выполняй push/);
    assert.match(contents, /по одной implementation subtask на каждый.*repository-id/);
    assert.match(contents, /parent_ticket, change_id, store_id, spec_baseline/);
    assert.doesNotMatch(contents, /spec_path/);
    assert.match(contents, /точными task\.id из структурированного/);
    assert.match(contents, /не извлекай ID из описаний Tasks/);
    assert.match(contents, /QA-subtask остаётся открытым решением/);
    assert.match(contents, /`sdd load --store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>\.\.\.`/);
    assert.match(contents, /При повторном load всегда передавай текущие параметры implementation subtask/);
    assert.match(contents, /не пытайся выводить их из Git-ветки или прежнего runtime/);
    assert.match(contents, /готовое первое сообщение указывает на `sdd-apply\.md` внутри runtime Store/);
    assert.match(contents, /Не требуй обнаружения slash-команды в Code Repository/);
  }
});

test("шаг 04 не вводит собственные команды review и baseline", async () => {
  const [step03, step04] = await Promise.all([
    read("../docs/steps/03.md"),
    read("../docs/steps/04.md"),
    assert.rejects(fs.stat(path.join(HARNESS_ROOT, "init/commands/sdd-review.md")), /ENOENT/),
    assert.rejects(fs.stat(path.join(HARNESS_ROOT, "init/commands/sdd-baseline.md")), /ENOENT/),
  ]);

  assert.match(step04, /не гарантирует, что каждый Work Package.*checkbox с явной целью/s);
  assert.match(step04, /пакет без цели блокирует merge/);
  assert.match(step04, /Машинный ID предоставляет сам OpenSpec в `tasks\[\]\.id`/);
  assert.match(step04, /Отдельный SDD-валидатор и собственный формат `tasks\.md`.*не вводятся/);
  assert.doesNotMatch(step04, /WP-PAYMENTS-API/);
  assert.match(step03, /`sdd connect`.*`opsx-update\.md`/);
});

test("sdd-change создаёт только Change и Proposal из текущего Explore", async () => {
  const command = await read("init/commands/sdd-change.md");

  assert.match(command, /sdd change --ticket <ticket-id> --name <short-name>/);
  assert.match(command, /openspec instructions proposal/);
  assert.match(command, /полного результата.*повторить `sdd explore`/s);
  assert.match(command, /proposal_status: needs_confirmation/);
  assert.match(command, /step_status: proposal_accepted/);
  assert.match(command, /не перечитывай Code Repositories/i);
  assert.match(command, /`\/opsx-propose` не вызывай/);
  assert.doesNotMatch(command, /\/opsx-propose` не вызывай[\s\S]*\/opsx-propose` не вызывай/);
});
