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

test("OpenSpec использует встроенную схему и native subagents SDD", async () => {
  const [contents, subagent] = await Promise.all([
    read("init/skeleton/openspec/config.yaml"),
    read("init/subagents/repository-context-pass.md"),
  ]);
  const config = parseYaml(contents);

  assert.equal(config.schema, "spec-driven");
  assert.deepEqual(Object.keys(config.rules).sort(), ["design", "proposal", "specs", "tasks"]);
  assert.match(config.context, /OpenSpec-артефакты.*пиши на русском языке/);
  assert.match(config.context, /Не переводи код, команды, пути, идентификаторы/);
  assert.doesNotMatch(config.context, /Первое сообщение|Общайся с пользователем/);
  assert.match(config.context, /центральном Store Repository/);
  assert.match(config.context, /agent\.instructions_file/);
  assert.match(config.context, /repository_instructions_path/);
  assert.match(config.context, /последний\s+сегмент не должен быть symlink/);
  assert.doesNotMatch(config.context, /родитель agent\.commands_directory/);
  assert.match(
    config.context,
    /технический контекст нескольких Code Repositories\s+или одного крупного/,
  );
  assert.match(config.context, /независимая проверка вывода/);
  assert.match(config.context, /разрешение противоречия/);
  assert.match(config.context, /подбери\s+специализацию по её `description`/);
  assert.match(config.context, /не поддерживай\s+фиксированный список optional subagents/);
  assert.match(config.context, /обязательный базовый subagent type `repository-context-pass`/);
  assert.match(config.context, /полный автономный prompt/);
  assert.match(config.context, /change_id, artifact, repository_id/);
  assert.match(config.context, /не объявляй контекст изолированным/);
  assert.match(config.context, /Единственный основной агент/);
  assert.match(subagent, /^---\nname: repository-context-pass$/m);
  assert.match(subagent, /model: inherit/);
  assert.match(subagent, /tools:\n {2}- read_file/);
  assert.doesNotMatch(subagent, /write_file|run_shell_command/);
  assert.match(subagent, /одного Code Repository и одного конкретного вопроса/);
  assert.match(subagent, /абсолютные `checkout` и `repository_instructions_path`/);
  assert.match(subagent, /сначала прочитай только этот файл/);
  assert.match(subagent, /repository_id: <repository-id>/);
  assert.match(subagent, /facts:/);
  assert.match(subagent, /system_impact:/);
  assert.match(subagent, /verification_implications:/);
  assert.match(subagent, /confidence: high/);
  assert.match(subagent, /open_questions: \[\]/);
  assert.match(subagent, /reference: path\/to\/file:line/);
  assert.match(config.rules.proposal.join("\n"), /Jira\/SberTrack key/);
  assert.match(config.rules.proposal.join("\n"), /repository-id/);
  assert.match(config.rules.proposal.join("\n"), /Code Repositories, известные по итогам Explore как кандидаты/);
  assert.match(config.rules.proposal.join("\n"), /окончательный технический impact.*design.md/);
  assert.match(config.rules.proposal.join("\n"), /Во всех разделах Proposal, кроме явно отделённого evidence/);
  assert.match(config.rules.proposal.join("\n"), /Не фиксируй названия файлов, каталогов, классов, функций/);
  assert.match(config.rules.proposal.join("\n"), /Отрицательный результат поиска.*ограниченное наблюдение Explore/);
  assert.match(config.rules.proposal.join("\n"), /не включай служебные действия OpenSpec/);
  assert.match(config.rules.proposal.join("\n"), /не создавай раздел, если вопросов нет/);
  assert.match(config.rules.specs.join("\n"), /межрепозиторный контракт/);
  assert.match(config.rules.specs.join("\n"), /классы.*хуки/);
  assert.match(config.rules.specs.join("\n"), /Каждый Requirement и Scenario должен прямо следовать из подтверждённого Proposal/);
  assert.match(config.rules.specs.join("\n"), /Не добавляй новые наблюдаемые состояния, значения, внешние системы или scope/);
  assert.match(config.rules.specs.join("\n"), /верни решение Change Owner на шаг Proposal/);
  assert.match(config.rules.design.join("\n"), /обязателен для каждого Change/);
  assert.match(config.rules.design.join("\n"), /только межсистемный уровень/);
  assert.match(config.rules.design.join("\n"), /окончательный технический impact.*точным ревизиям/);
  assert.match(config.rules.design.join("\n"), /точный repository_instructions_path/);
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
  assert.match(config.rules.tasks.join("\n"), /обновление файла инструкций агента/);
  assert.match(config.rules.tasks.join("\n"), /окончательного технического impact design.md/);

  await assert.rejects(
    fs.stat(
      path.join(HARNESS_ROOT, "init/skeleton/openspec/schemas/multi-repo-sdd/schema.yaml"),
    ),
    /ENOENT/,
  );
});

test("sdd-apply реализует шаг 06 в границах одного Code Repository", async () => {
  const apply = await read("init/commands/sdd-apply.md");

  assert.match(apply, /standalone-инструкция.*Code Repository.*может отсутствовать/s);
  assert.match(apply, /языковой контракт.*обязательным локальным fallback/);
  assert.match(apply, /Первое сообщение.*на русском языке/);
  assert.match(apply, /Не переводи только код, команды, пути, идентификаторы/);
  assert.match(apply, /openspec validate <change-id> --type change --strict --no-interactive --json/);
  assert.match(apply, /<repository-id>\/context\.json/);
  assert.match(apply, /openspec instructions apply --change <change-id> --json/);
  assert.match(apply, /--store <store-id> --repo <repository-id> --change <change-id> --baseline <sha> --work-package <id>\.\.\./);
  assert.match(apply, /готовым первым сообщением `next_action`/);
  assert.match(apply, /Используй тот же набор значений, который был передан в успешный `sdd load`/);
  assert.match(apply, /не вычисляй Store, repository, Baseline или Work Packages автоматически/i);
  assert.match(apply, /один или несколько уникальных `--work-package`/);
  assert.match(apply, /`allowed_edit_roots` не содержит ровно один `code_root`/);
  assert.match(apply, /`immutable_roots` не содержит ровно один `spec_root`/);
  assert.match(apply, /точные пары `id → description`/);
  assert.match(apply, /Каждый `task\.id` означает один checkbox OpenSpec/);
  assert.match(apply, /Число в начале `description`.*не `task\.id`/s);
  assert.match(apply, /Не объединяй несколько ID в один пакет/);
  assert.match(apply, /Если файла нет или сведений недостаточно/);
  assert.match(apply, /Локальный technical design, implementation plan или checklist.*необязателен/s);
  assert.match(apply, /нельзя завершить без записи в другой Code Repository, Composite Verification или недоступного внешнего окружения/);
  assert.match(apply, /Не заменяй проверку указанного в Work Package другого репозитория или точной ревизии локальной имитацией/);
  assert.match(apply, /При повторном запуске с теми же параметрами.*Новый progress-state не создавай/s);
  assert.match(apply, /Используй только уже существующие в репозитории инструменты и конфигурацию проверок/);
  assert.match(apply, /Не добавляй package manager, зависимости, test runner, build-конфигурацию или отдельные скомпилированные файлы только ради запуска проверки/);
  assert.match(apply, /`passed` допустимо только для действительно выполненной команды с успешным exit code/);
  assert.match(apply, /отсутствие инструмента, конфигурации или test runner никогда не является `passed`/);
  assert.match(apply, /Невыполненную проверку укажи как `Not run` с причиной/);
  assert.match(apply, /Созданный, но не запущенный тест не завершает такой Work Package/);
  assert.match(apply, /сначала сравни результат с `code_base_revision`/);
  assert.match(apply, /Не создавай commit, не выполняй push или rebase, не открывай и не изменяй PR или tracker без отдельного явного поручения пользователя/);
  assert.match(apply, /Implementation PR на шаге 06 не сливай/);
  assert.match(apply, /Не отмечай checkbox в центральном `tasks\.md`/);
  assert.match(apply, /provider-specific agent pack/);
  assert.doesNotMatch(apply, /\.(?:qwen|gigacode)\/.*(?:openspec-|opsx-)/);
  assert.match(apply, /work_package_results:/);
  assert.match(apply, /status: completed \| incomplete \| blocked/);
  assert.match(apply, /только если каждый переданный ID имеет статус `completed`/);
  assert.match(apply, /обязательная проверка `Not run` требует `implementation_in_progress` либо `blocked`/);
  assert.match(apply, /next_step: complete_checks \| implementation_pr \| 07 \| blocked/);
  assert.match(apply, /`next_step: implementation_pr` — только для `implementation_ready_for_pr`/);
  assert.match(apply, /Никогда не указывай Archive следующим шагом/);
  assert.doesNotMatch(apply, /sdd open|sdd instructions apply|digest Work Package/);

  await assert.rejects(
    fs.stat(path.join(HARNESS_ROOT, "init/commands/sdd-verify.md")),
    /ENOENT/,
  );
});

test("Store-команды и context pack не дублируют общий языковой контракт", async () => {
  const [contextCommand, changeCommand, contextEntryPoint] = await Promise.all([
    read("init/commands/sdd-context.md"),
    read("init/commands/sdd-change.md"),
    read("init/skeleton/openspec/context/00-start-here.md"),
  ]);

  for (const contents of [contextCommand, changeCommand, contextEntryPoint]) {
    assert.doesNotMatch(contents, /Первое сообщение|Рабочий язык|общайся с пользователем/i);
    assert.doesNotMatch(contents, /Не переводи (?:только )?код, команды, пути/);
  }
});

test("инструкции агентов направляют завершённый Planning на шаг 04", async () => {
  const [qwenInstructions, gigaInstructions] = await Promise.all([
    read("init/agents/qwen/QWEN.md"),
    read("init/agents/gigacode/.gigacode/GIGACODE.md"),
  ]);

  for (const contents of [qwenInstructions, gigaInstructions]) {
    assert.match(contents, /Первое сообщение.*всегда начинай на русском языке/);
    assert.match(contents, /built-in `\/opsx-continue`/);
    assert.match(contents, /`isComplete: true`.*до вызова `openspec instructions`/s);
    assert.match(contents, /новой сессии.*до первого `\/opsx-continue`.*полный `proposal\.md`/s);
    assert.match(contents, /явное подтверждение.*принятый вход/s);
    assert.match(contents, /Не выводи подтверждение из наличия файла или статуса OpenSpec `done`/);
    assert.match(contents, /`isComplete: true`.*только завершение Proposal, Specs, Design и Tasks/s);
    assert.match(contents, /единственным маршрутом: шаг 04, Planning PR и фиксация Spec Baseline/);
    assert.match(contents, /Сам Apply или Archive не запускай/);
    assert.doesNotMatch(
      contents,
      /## Planning PR|## Начало реализации|`\/opsx-update|sdd review|sdd baseline|implementation subtask|QA-subtask|sdd load|sdd-apply\.md|task\.id|Composite Verification/,
    );
  }

  const withoutProviderHeading = (contents) => contents.replace(/^# Инструкции для .+\n/, "");
  assert.equal(
    withoutProviderHeading(qwenInstructions),
    withoutProviderHeading(gigaInstructions),
  );

  await Promise.all([
    assert.rejects(fs.stat(path.join(HARNESS_ROOT, "init/commands/sdd-review.md")), /ENOENT/),
    assert.rejects(fs.stat(path.join(HARNESS_ROOT, "init/commands/sdd-baseline.md")), /ENOENT/),
  ]);
});

test("sdd-change создаёт только Change и Proposal из текущего Explore", async () => {
  const command = await read("init/commands/sdd-change.md");

  assert.match(command, /sdd change --ticket <ticket-id> --name <short-name> --store <store-id>/);
  assert.match(command, /проверяет, что он совпадает с текущим центральным checkout/);
  assert.match(command, /openspec instructions proposal/);
  assert.match(command, /полного результата.*повторить `sdd explore`/s);
  assert.match(command, /Сначала подготовь черновик.*не записывай его в файл/);
  assert.match(command, /Во всех разделах, кроме явно отделённого evidence.*наблюдаемое поведение/s);
  assert.match(command, /Не указывай названия файлов, каталогов, классов, функций/);
  assert.match(command, /Технические имена.*только в отдельном разделе источников как evidence/s);
  assert.match(command, /Отрицательный результат поиска.*ограниченное наблюдение/);
  assert.match(command, /Открытый вопрос допустим только для неразрешённого поведения или scope/);
  assert.match(command, /не должен.*описывать служебные действия OpenSpec/s);
  assert.match(command, /До записи выполни обязательную проверку черновика/);
  assert.match(command, /утверждения разных разделов не противоречат друг другу/);
  assert.match(command, /Если хотя бы одна проверка не пройдена.*повтори всю проверку/s);
  assert.match(command, /Только после успешной проверки запиши Proposal/);
  assert.match(command, /proposal_status: needs_confirmation/);
  assert.match(command, /step_status: proposal_accepted/);
  assert.match(command, /не перечитывай Code Repositories/i);
  assert.match(command, /`\/opsx-propose` не вызывай/);
  assert.doesNotMatch(command, /\/opsx-propose` не вызывай[\s\S]*\/opsx-propose` не вызывай/);
});
