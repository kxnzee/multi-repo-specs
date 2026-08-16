/** @fileoverview Декларативный контракт OpenSpec Orchestrator CLI. */

import { Command, InvalidArgumentError, Option } from "commander";

import { parseRepository } from "../internal/init/index.js";
import { runAssign } from "./commands/assign.js";
import { runConnect } from "./commands/connect.js";
import { runInit } from "./commands/init.js";
import { runRepositoryStatus } from "./commands/repository.js";
import { runRecordAssignment } from "./commands/record-assignment.js";
import { runRecordVerification } from "./commands/record-verification.js";
import { runStatus } from "./commands/status.js";
import { runVerify } from "./commands/verify.js";

const DEFAULT_HANDLERS = Object.freeze({
  init: runInit,
  connect: runConnect,
  repositoryStatus: runRepositoryStatus,
  assign: runAssign,
  status: runStatus,
  recordAssignment: runRecordAssignment,
  verify: runVerify,
  recordVerification: runRecordVerification,
});

/**
 * Запрещает повтор одиночной опции и применяет её предметный parser.
 *
 * @param {(value: string) => unknown} [parser] Проверка и нормализация значения.
 * @returns {(value: string, previous: unknown) => unknown} Commander parser.
 */
function singleValue(parser = (value) => value) {
  return (value, previous) => {
    if (value.startsWith("--")) throw new InvalidArgumentError("ожидается значение опции");
    if (previous !== undefined) throw new InvalidArgumentError("опцию можно указать только один раз");
    return parser(value);
  };
}

/**
 * Собирает повторяемую опцию в массив.
 *
 * @param {(value: string) => unknown} [parser] Проверка и нормализация элемента.
 * @returns {(value: string, previous: unknown[]) => unknown[]} Commander parser.
 */
function collectValues(parser = (value) => value) {
  return (value, previous = []) => [...previous, parser(value)];
}

/**
 * Добавляет общий relaxed-переключатель к команде.
 *
 * @param {Command} command Настраиваемая команда.
 * @returns {Command} Та же команда.
 */
function withExecutionMode(command) {
  return command.option(
    "--no-strict",
    "отключить Git pinning и automation для текущего вызова",
  );
}

/**
 * Создаёт CLI-программу с заменяемыми обработчиками для изолированного тестирования.
 *
 * @param {typeof DEFAULT_HANDLERS} [handlers] Обработчики нормализованных команд.
 * @returns {Command} Настроенная Commander-программа.
 */
export function createProgram(handlers = DEFAULT_HANDLERS) {
  const program = new Command()
    .name("openspec-orch")
    .description("OpenSpec Orchestrator: Cycle и Snapshot для multi-repo Change")
    .showHelpAfterError()
    .exitOverride();

  withExecutionMode(program.command("init [path]", { isDefault: false })
    .description("создать OpenSpec Store и применить Project Template")
    .requiredOption("--store <store-id>", "Store ID", singleValue())
    .requiredOption("--agent <agent-id>", "agent mapping из Project Template", singleValue())
    .addOption(new Option("--template <path>", "локальный Project Template").argParser(singleValue()))
    .addOption(new Option("--repo <id=remote#branch>", "добавить Code Repository").argParser(collectValues(parseRepository))))
    .action((target = ".", options) => handlers.init({
      target,
      storeId: options.store,
      agentId: options.agent,
      templateRoot: options.template,
      repositories: options.repo ?? [],
      noStrict: options.strict === false,
    }));

  withExecutionMode(program.command("connect")
    .description("подключить рабочую машину и Code Repositories")
    .addOption(new Option("--workspace <path>", "явный workspace").argParser(singleValue())))
    .action((options) => handlers.connect({
      workspace: options.workspace,
      noStrict: options.strict === false,
    }));

  const repository = program.command("repository")
    .description("операции только чтения над репозиториями реестра");
  repository.command("status")
    .description("показать подключение, чистоту, remote и ветку каждого репозитория")
    .addOption(new Option("--repo <repository-id>", "ограничить вывод одним repository-id").argParser(collectValues()))
    .action((options) => handlers.repositoryStatus({ repositoryIds: options.repo ?? [] }));

  program.command("assign <change-id>")
    .description("создать или подтвердить текущий Cycle для change-id")
    .requiredOption("--repo <repository-id>", "repository-id из состава Cycle", collectValues())
    .action((changeId, options) => handlers.assign({
      changeId,
      repositoryIds: options.repo,
    }));

  program.command("status <change-id>")
    .description("показать текущий Cycle Record и следующее действие")
    .action((changeId) => handlers.status({ changeId }));

  const record = program.command("record")
    .description("записать внешний результат в локальное состояние");
  record.command("assignment <change-id>")
    .description("записать Result Receipt одного Code Repository")
    .addOption(new Option("--repo <repository-id>", "repository-id из текущего Cycle")
      .argParser(singleValue()).makeOptionMandatory())
    .addOption(new Option("--commit <sha>", "точный commit результата")
      .argParser(singleValue()).makeOptionMandatory())
    .addOption(new Option("--status <status>", "статус результата")
      .choices(["completed", "failed", "blocked"]).makeOptionMandatory())
    .addOption(new Option("--source <source>", "источник результата")
      .choices(["human", "agent", "ci"]).makeOptionMandatory())
    .addOption(new Option("--note <text>", "необязательная заметка").argParser(singleValue()))
    .action((changeId, options) => handlers.recordAssignment({
      changeId,
      repositoryId: options.repo,
      implementationRevision: options.commit,
      status: options.status,
      source: options.source,
      note: options.note,
    }));

  program.command("verify <change-id>")
    .description("вычислить Snapshot текущих completed Result Receipts")
    .action((changeId) => handlers.verify({ changeId }));

  record.command("verification <change-id>")
    .description("записать Verification Receipt последнего текущего Snapshot")
    .addOption(new Option("--result <result>", "результат внешней проверки")
      .choices(["pass", "fail"]).makeOptionMandatory())
    .addOption(new Option("--source <source>", "источник результата")
      .choices(["human", "agent", "ci"]).makeOptionMandatory())
    .addOption(new Option("--note <text>", "необязательная заметка").argParser(singleValue()))
    .action((changeId, options) => handlers.recordVerification({
      changeId,
      result: options.result,
      source: options.source,
      note: options.note,
    }));

  return program;
}
