/** @fileoverview Неинтерактивный CLI для авторов и Agent skills. */

import process from "node:process";

import { Command, Option } from "commander";
import { AddonAuthoringService } from "./authoring.js";
import { validateAddon } from "./validation.js";

/** Накапливает повторяемые CLI arguments. */
function collect(value, previous = []) {
  return [...previous, value];
}

/** Собирает подкоманду create для основного CLI; создание не требует Store. */
export function createAuthoringCommand({ agentProvider, stdout = (text) => process.stdout.write(text) }) {
  const program = new Command("create");
  const service = new AddonAuthoringService({ agentProvider });
  program.description("Создать Extension (инструкции агенту), Plugin (исполняемые команды) или Template (файлы нового проекта)")
    .option("--json", "машиночитаемый результат")
    .exitOverride().showHelpAfterError(false);
  /** Печатает результат с явной границей структурной проверки. */
  function output(result, command) {
    if (command.optsWithGlobals().json) stdout(`${JSON.stringify(result)}\n`);
    else {
      stdout(`${result.kind}: ${result.root}\n`);
      if (result.editable) stdout(`Редактируйте: ${result.editable.join(", ")}\n`);
      stdout("Структура проверена. Прикладное поведение не проверялось.\n");
      if (result.next) stdout(`После изменений вызовите ${result.next.command} с аргументами: ${JSON.stringify(result.next.args)}\n`);
    }
  }
  for (const [kind, description] of [
    ["extension", "инструкции и навык для ИИ-агента"],
    ["plugin", "исполняемая команда или интеграция"],
    ["template", "начальные файлы и контекст нового проекта"],
  ]) {
    const command = program.command(`${kind} <id> [path]`).description(description)
      .option("--name <name>", "читаемое название");
    if (kind === "extension") command.option("--agent <id>", "поддерживаемый агент; повторяемый, по умолчанию все", collect);
    if (kind === "extension") command.addOption(new Option("--target <role>", "store или code; повторяемый").choices(["store", "code"]).argParser(collect));
    if (kind === "plugin") {
      command.addOption(new Option("--profile <profile>", "тип Plugin").choices(["commands", "repository", "native"]).default("commands"))
        .addOption(new Option("--support <role>", "роль для repository/native; повторяемый").choices(["store", "code"]).argParser(collect))
        .option("--extension", "добавить Plugin-owned Extension для repository/native");
    }
    command.action(async (id, targetRoot, options) => output(await service.create({
      kind, id, targetRoot, name: options.name, agents: options.agent, targets: options.target,
      profile: options.profile, supports: options.support, extension: options.extension,
    }), command));
  }
  const validate = program.command("validate <path>").description("проверить структуру; --load импортирует локальный JavaScript Plugin")
    .addOption(new Option("--kind <kind>", "тип дополнения").choices(["extension", "plugin", "template"]).makeOptionMandatory())
    .option("--load", "загрузить Plugin export и проверить command grammar; нужны установленные зависимости");
  validate.action(async (root, options) => output(await validateAddon({ root, kind: options.kind, load: options.load, agentProvider }), validate));
  return program;
}
