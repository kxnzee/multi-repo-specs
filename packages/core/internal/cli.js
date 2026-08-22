/** @fileoverview Candidate CLI composition для перенесённых Core operations. */

import path from "node:path";

import { Command, InvalidArgumentError, Option } from "commander";

import { configuration } from "./configuration.js";
import { initialization } from "./initialization.js";
import { workspace } from "./workspace.js";

/** Запрещает повтор одиночной Commander option. */
function singleValue(value, previous) {
  if (value.startsWith("--")) throw new InvalidArgumentError("ожидается значение опции");
  if (previous !== undefined) throw new InvalidArgumentError("опцию можно указать только один раз");
  return value;
}

/** Собирает повторяемую Commander option. */
function collectRepositories(value, previous = []) {
  return [...previous, configuration.parseRepositoryArgument(value)];
}

/** Печатает список созданных или обновлённых файлов. */
function printPaths(title, paths) {
  console.log(`${title} (${paths.length})`);
  for (const filePath of paths) console.log(`  ${filePath}`);
}

/** Формирует подсказку следующего connect с учётом layout Store. */
function buildConnectHint(storeRoot, storeId) {
  const workspaceRoot = path.dirname(storeRoot);
  const command = workspace.inferStandard(storeRoot, storeId)
    ? "openspec-orch connect"
    : `openspec-orch connect --workspace ${JSON.stringify(workspaceRoot)}`;
  return `Далее: выполните ${command}`;
}

/** Собирает candidate CLI из публичных Core application services. */
export class CandidateCli {
  #initialization;
  #templateRoot;

  constructor({ initializationService = initialization, templateRoot } = {}) {
    this.#initialization = initializationService;
    this.#templateRoot = templateRoot;
    Object.freeze(this);
  }

  createProgram() {
    const program = new Command()
      .name("openspec-orch")
      .description("OpenSpec Orchestrator: Cycle и Snapshot для multi-repo Change")
      .showHelpAfterError();
    program.command("init [path]")
      .description("создать OpenSpec Store и применить Project Template")
      .requiredOption("--store <store-id>", "Store ID", singleValue)
      .requiredOption("--agent <agent-id>", "agent mapping из Project Template", singleValue)
      .addOption(new Option("--template <path>", "локальный Project Template").argParser(singleValue))
      .addOption(new Option("--repo <id=remote#branch>", "добавить Code Repository")
        .argParser(collectRepositories))
      .option("--no-strict", "отключить Git pinning и automation для текущего вызова")
      .action(async (target = ".", options) => {
        const result = await this.#initialization.initialize({
          target,
          storeId: options.store,
          agentId: options.agent,
          templateRoot: options.template ?? this.#templateRoot,
          repositories: options.repo ?? [],
          noStrict: options.strict === false,
        });
        if (result.alreadyInitialized) {
          console.log(`Store ${result.storeId} уже инициализирован; файлы не изменены.`);
          console.log(`Execution mode: ${result.executionMode}`);
          console.log(buildConnectHint(result.target, result.storeId));
          return;
        }
        console.log(`Store ${result.storeId}: ${result.target}`);
        console.log(`Agent: ${options.agent}`);
        console.log(`Execution mode: ${result.executionMode}`);
        printPaths("Создано", result.created);
        if (result.updated.length > 0) printPaths("Дополнено", result.updated);
        console.log(buildConnectHint(result.target, result.storeId));
      });
    return program;
  }
}
