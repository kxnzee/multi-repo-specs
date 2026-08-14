/** @fileoverview Декларативный контракт OpenSpec Orchestrator CLI. */

import { Command, InvalidArgumentError, Option } from "commander";

import { validateChangeName } from "../change/index.js";
import { assertRepositoryId } from "../config/index.js";
import { validateTicket } from "../explore/index.js";
import { parseRepository } from "../init/index.js";
import { isGitRevision } from "../shared/schema.js";
import { runChange } from "./change.js";
import { runConnect } from "./connect.js";
import { runExplore } from "./explore.js";
import { runInit } from "./init.js";
import { runLoad } from "./load.js";

const DEFAULT_HANDLERS = Object.freeze({
  init: runInit,
  connect: runConnect,
  explore: runExplore,
  change: runChange,
  load: runLoad,
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
 * Собирает уникальные строковые значения повторяемой опции.
 *
 * @param {string} value Очередное значение.
 * @param {string[]} [previous] Уже разобранные значения.
 * @returns {string[]} Обновлённый список.
 */
function collectUniqueValues(value, previous = []) {
  if (previous.includes(value)) throw new InvalidArgumentError(`${value} передан дважды`);
  return [...previous, value];
}

/**
 * Проверяет полную lowercase SHA-1 ревизию.
 *
 * @param {string} value Значение `--baseline`.
 * @returns {string} Проверенная ревизия.
 */
function parseBaseline(value) {
  if (!isGitRevision(value)) {
    throw new InvalidArgumentError("ожидается полная lowercase 40-символьная SHA");
  }
  return value;
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
    .description("Мультирепозиторный OpenSpec Orchestrator")
    .showHelpAfterError()
    .exitOverride();

  withExecutionMode(program.command("init [path]", { isDefault: false })
    .description("создать OpenSpec Store и применить Project Template")
    .requiredOption("--store <store-id>", "Store ID", singleValue())
    .requiredOption("--agent <agent-id>", "agent mapping из Project Template", singleValue())
    .addOption(new Option("--template <path>", "локальный Project Template").argParser(singleValue()))
    .addOption(new Option("--repo <id=url#branch>", "добавить Code Repository").argParser(collectValues(parseRepository))))
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

  withExecutionMode(program.command("explore")
    .description("подготовить проверенный вызов /opsx-explore")
    .requiredOption("--ticket <ticket-id>", "ticket key", singleValue(validateTicket))
    .addOption(new Option("--workspace <path>", "явный workspace").argParser(singleValue())))
    .action((options) => handlers.explore({
      ticket: options.ticket,
      workspace: options.workspace,
      noStrict: options.strict === false,
    }));

  withExecutionMode(program.command("change")
    .description("создать или безопасно продолжить OpenSpec Change")
    .requiredOption("--ticket <ticket-id>", "ticket key", singleValue(validateTicket))
    .requiredOption("--name <short-name>", "Change ID suffix", singleValue(validateChangeName))
    .addOption(new Option("--store <store-id>", "ожидаемый Store ID").argParser(singleValue((value) => assertRepositoryId(value, "Store ID")))))
    .action((options) => handlers.change({
      ticket: options.ticket,
      name: options.name,
      storeId: options.store,
      noStrict: options.strict === false,
    }));

  withExecutionMode(program.command("load")
    .description("подготовить Code Repository и runtime реализации")
    .requiredOption("--store <store-id>", "Store ID", singleValue((value) => assertRepositoryId(value, "Store ID")))
    .requiredOption("--repo <repository-id>", "Code Repository ID", singleValue(assertRepositoryId))
    .requiredOption("--change <change-id>", "OpenSpec Change ID", singleValue(validateChangeName))
    .addOption(new Option("--baseline <sha>", "полная Git SHA принятого Store").argParser(singleValue(parseBaseline)))
    .addOption(new Option("--work-package <id>", "назначенный task.id").argParser(collectUniqueValues))
    .option("--json", "вернуть результат в JSON"))
    .action((options) => handlers.load({
      storeId: options.store,
      repositoryId: options.repo,
      change: options.change,
      baseline: options.baseline,
      workPackages: options.workPackage ?? [],
      noStrict: options.strict === false,
      json: options.json === true,
    }));

  return program;
}
