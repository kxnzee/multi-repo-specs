/** @fileoverview Candidate CLI composition для перенесённых Core operations. */

import path from "node:path";

import { Command, Option } from "commander";

import { collectValues, singleValue } from "./cli-values.js";
import { configuration } from "./configuration.js";
import { CORE_FILES } from "./constants.js";
import { connection } from "./connection.js";
import { initialization } from "./initialization.js";
import { repositoryStatuses } from "./repository-status.js";
import { workspace } from "./workspace.js";

/** Собирает повторяемую Commander option. */
function collectRepositories(value, previous = []) {
  return [...previous, configuration.parseRepositoryArgument(value)];
}

/** Печатает read-only состояние одного Repository. */
function printRepositoryStatus(status) {
  console.log(`${status.id} (${status.role}): ${status.state}`);
  if (status.path) console.log(`  path: ${status.path}`);
  if (status.connected) {
    console.log(
      `  branch: ${status.branch}${status.branchMatches ? "" : " (не совпадает с default_branch)"}`,
    );
    const remoteState = status.remoteMatches
      ? "совпадает"
      : `не совпадает с ${CORE_FILES.orchestratorConfig}`;
    console.log(`  remote: ${remoteState}`);
    console.log(`  clean: ${status.clean ? "да" : "нет"}`);
  }
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
  #connection;
  #initialization;
  #pluginCommands;
  #pluginLifecycleCommands;
  #repositoryStatuses;
  #templateRoot;

  constructor({
    connectionService = connection,
    initializationService = initialization,
    pluginCommandMounter,
    pluginLifecycleCommands,
    repositoryStatusService = repositoryStatuses,
    templateRoot,
  } = {}) {
    this.#connection = connectionService;
    this.#initialization = initializationService;
    if (pluginCommandMounter && typeof pluginCommandMounter.mount !== "function") {
      throw new Error("CLI_INVALID: pluginCommandMounter должен предоставлять mount");
    }
    this.#pluginCommands = pluginCommandMounter;
    if (pluginLifecycleCommands && typeof pluginLifecycleCommands.mount !== "function") {
      throw new Error("CLI_INVALID: pluginLifecycleCommands должен предоставлять mount");
    }
    this.#pluginLifecycleCommands = pluginLifecycleCommands;
    this.#repositoryStatuses = repositoryStatusService;
    this.#templateRoot = templateRoot;
    Object.freeze(this);
  }

  createProgram() {
    const program = new Command()
      .name("openspec-orch")
      .description("OpenSpec Orchestrator: Cycle и Snapshot для multi-repo Change")
      .showHelpAfterError()
      .exitOverride();
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
    program.command("connect")
      .description("подключить рабочую машину и Code Repositories")
      .addOption(new Option("--workspace <path>", "явный workspace").argParser(singleValue))
      .option("--no-strict", "отключить Git pinning и automation для текущего вызова")
      .action(async (options) => {
        const result = await this.#connection.connect({
          workspace: options.workspace,
          noStrict: options.strict === false,
        });
        console.log(`Store: ${result.storeId} (${result.storeRoot})`);
        console.log(`Workspace: ${result.workspace}`);
        console.log(`Execution mode: ${result.executionMode}`);
        if (options.workspace && result.executionMode === "strict") {
          console.log("Workspace сохранён локально для следующих команд OpenSpec Orchestrator.");
        } else if (options.workspace) {
          console.log("Workspace использован только для текущего relaxed-вызова и не сохранён локально.");
        }
        console.log("Локальная регистрация Store проверена OpenSpec.");
        for (const repository of result.repositories) {
          console.log(
            `${repository.id}: ${repository.status}${repository.cloned ? ", cloned" : ", existing"}`,
          );
          console.log(`  ${repository.path}`);
          if (repository.pointerCreated) {
            console.log(`  создан ${CORE_FILES.openSpecConfig}; требуется setup PR`);
          } else if (repository.pointerPending) {
            console.log(`  ${CORE_FILES.openSpecConfig} ещё не принят; требуется setup PR`);
          }
        }
        console.log(`connect_status: ${result.status}`);
        if (result.status === "ready") console.log("Локальное подключение готово.");
      });
    this.#pluginLifecycleCommands?.mount(program);
    const repository = program.command("repository")
      .description("операции только чтения над репозиториями реестра");
    repository.command("status")
      .description("показать подключение, чистоту, remote и ветку каждого репозитория")
      .addOption(new Option("--repo <repository-id>", "ограничить вывод одним repository-id")
        .argParser(collectValues))
      .action(async (options) => {
        const statuses = await this.#repositoryStatuses.inspect({
          repositoryIds: options.repo ?? [],
        });
        for (const status of statuses) printRepositoryStatus(status);
      });
    this.#pluginCommands?.mount(program);
    return program;
  }
}
