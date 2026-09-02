/** @fileoverview Candidate CLI composition для перенесённых Core operations. */

import path from "node:path";
import process from "node:process";

import { collectValues, createCliProgress, singleValue } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";

import { configuration } from "./configuration.js";
import { CORE_EXECUTION_MODE, CORE_FILES } from "./constants.js";
import { doctor } from "./doctor.js";
import { ProjectSetupService } from "./project-setup.js";
import { repositoryStatuses } from "./repository-status.js";
import { hasMethods } from "./value.js";
import { formatDoctorReport, formatStatusHeading } from "./status-output.js";
import { workspace } from "./workspace.js";

/** Собирает повторяемую Commander option. */
function collectRepositories(value, previous = []) {
  return [...previous, configuration.parseRepositoryArgument(value)];
}

/** Печатает read-only состояние одного Repository. */
function printRepositoryStatus(status) {
  console.log(formatStatusHeading(`${status.id} [${status.role}]`, status.state));
  if (status.path) console.log(`  Путь: ${status.path}`);
  if (status.connected) {
    console.log(
      `  ${status.branchMatches ? "✓" : "✗"} Ветка: ${status.branch}` +
        (status.branchMatches ? "" : " — не совпадает с default_branch"),
    );
    console.log(
      `  ${status.remoteMatches ? "✓" : "✗"} Remote: ` +
        (status.remoteMatches ? "совпадает" : `не совпадает с ${CORE_FILES.orchestratorConfig}`),
    );
    console.log(`  ${status.clean ? "✓" : "⚠"} Рабочее дерево: ${status.clean ? "чистое" : "есть изменения"}`);
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
  #agentGateway;
  #doctor;
  #pluginLifecycleCommands;
  #progress;
  #repositoryStatuses;
  #setup;

  constructor({
    agentGatewayService,
    bundledTemplateProvider,
    connectionService,
    doctorService = doctor,
    extensionLifecycle,
    initSelectionService,
    initializationService,
    pluginExtensionConnector,
    pluginLifecycleCommands,
    progress = createCliProgress(),
    repositoryStatusService = repositoryStatuses,
    setupService,
    start = process.cwd(),
    templateRoot,
  } = {}) {
    if (agentGatewayService && !hasMethods(
      agentGatewayService,
      ["listAgents", "remove", "setup", "status"],
    )) {
      throw new Error("CLI_INVALID: agentGatewayService несовместим");
    }
    this.#agentGateway = agentGatewayService;
    if (!hasMethods(doctorService, ["inspect"])) {
      throw new Error("CLI_INVALID: doctorService должен предоставлять inspect");
    }
    this.#doctor = doctorService;
    if (extensionLifecycle && !hasMethods(
      extensionLifecycle,
      ["connectSelected", "disconnectSelected", "preflight", "statusSelected"],
    )) {
      throw new Error(
        "CLI_INVALID: extensionLifecycle должен предоставлять preflight и selected lifecycle",
      );
    }
    if (pluginExtensionConnector && !hasMethods(
      pluginExtensionConnector,
      ["connectSelected", "disconnectSelected", "statusSelected"],
    )) {
      throw new Error(
        "CLI_INVALID: pluginExtensionConnector должен предоставлять connectSelected, " +
          "statusSelected и disconnectSelected",
      );
    }
    if (pluginLifecycleCommands && typeof pluginLifecycleCommands.mount !== "function") {
      throw new Error("CLI_INVALID: pluginLifecycleCommands должен предоставлять mount");
    }
    this.#pluginLifecycleCommands = pluginLifecycleCommands;
    if (!hasMethods(progress, ["fail", "run", "start", "succeed", "update", "warn"])) {
      throw new Error("CLI_INVALID: progress должен предоставлять renderer contract");
    }
    this.#progress = progress;
    this.#repositoryStatuses = repositoryStatusService;
    this.#setup = setupService ?? new ProjectSetupService({
      bundledTemplateProvider,
      connectionService,
      extensionLifecycle,
      initializationService,
      initSelectionService,
      pluginExtensionConnector,
      start,
      templateRoot,
    });
    Object.freeze(this);
  }

  createProgram() {
    const program = new Command()
      .name("openspec-orch")
      .description("OpenSpec Orchestrator для multi-repository OpenSpec workflow")
      .enablePositionalOptions()
      .showHelpAfterError()
      .exitOverride();
    program.command("init [path]")
      .description("создать OpenSpec Store и применить Project Template")
      .addOption(new Option("--store <store-id>", "Store ID").argParser(singleValue))
      .addOption(new Option("--agent <agent-id>", "независимый Agent ID").argParser(singleValue))
      .addOption(new Option(
        "--template <id-or-path>",
        "bundled Template ID с Extension-профилем или локальный Project Template",
      ).argParser(singleValue))
      .addOption(new Option("--extension <extension-id>", "выбрать standalone Extension")
        .argParser(collectValues))
      .option("--no-extensions", "явно выбрать пустой список Extensions")
      .addOption(new Option("--repo <id=remote#branch>", "добавить Code Repository")
        .argParser(collectRepositories))
      .option("--no-strict", "отключить Git pinning и automation для текущего вызова")
      .action((target = ".", options) => this.#initialize(target, options));
    program.command("doctor")
      .description("проверить готовность Store и локального окружения без изменений")
      .option("--json", "вывести машиночитаемый Diagnostic Report")
      .action((options) => this.#diagnose({ json: Boolean(options.json) }));
    program.command("connect")
      .description("подключить рабочую машину и Code Repositories")
      .addOption(new Option("--workspace <path>", "явный workspace").argParser(singleValue))
      .option("--no-strict", "отключить Git pinning и automation для текущего вызова")
      .action((options) => this.#connect(options));
    program.command("disconnect")
      .description("локально отключить Agent Extensions без изменения Store config")
      .action(() => this.#disconnect());
    if (this.#agentGateway) this.#mountAgentGateway(program);
    this.#pluginLifecycleCommands?.mount(program);
    const repository = program.command("repository")
      .description("операции только чтения над репозиториями реестра");
    repository.command("status")
      .description("показать подключение, чистоту, remote и ветку каждого репозитория")
      .addOption(new Option("--repo <repository-id>", "ограничить вывод одним repository-id")
        .argParser(collectValues))
      .action((options) => this.#inspectRepositories(options));
    return program;
  }

  #mountAgentGateway(program) {
    const agent = program.command("agent")
      .description("одноразовая user-level настройка Agent gateway");
    const agentOption = () => new Option("--agent <agent-id>", "Agent provider")
      .choices(this.#agentGateway.listAgents().map(({ id }) => id))
      .makeOptionMandatory();
    agent.command("setup")
      .description("установить и проверить gateway в user scope")
      .addOption(agentOption())
      .action((options) => this.#setupAgentGateway(options.agent));
    agent.command("status")
      .description("проверить user-level gateway без изменений")
      .addOption(agentOption())
      .action((options) => this.#statusAgentGateway(options.agent));
    agent.command("remove")
      .description("удалить user-level gateway")
      .addOption(agentOption())
      .action((options) => this.#removeAgentGateway(options.agent));
  }

  async #setupAgentGateway(agentId) {
    const result = await this.#progress.run(
      `Настройка Agent gateway для ${agentId}...`,
      () => this.#agentGateway.setup(agentId),
      { success: `Agent gateway для ${agentId} готов` },
    );
    this.#printAgentGateway(result);
  }

  async #statusAgentGateway(agentId) {
    const result = await this.#progress.run(
      `Проверка Agent gateway для ${agentId}...`,
      () => this.#agentGateway.status(agentId),
      { success: `Agent gateway для ${agentId} готов` },
    );
    this.#printAgentGateway(result);
  }

  async #removeAgentGateway(agentId) {
    const result = await this.#progress.run(
      `Удаление Agent gateway для ${agentId}...`,
      () => this.#agentGateway.remove(agentId),
      { success: `Agent gateway для ${agentId} удалён` },
    );
    this.#printAgentGateway(result);
  }

  #printAgentGateway(result) {
    console.log(`Agent: ${result.agent_id}`);
    console.log(`Extension: ${result.extension_id}`);
    console.log(`Scope: ${result.scope}`);
    console.log(`Status: ${result.status}`);
  }

  async #initialize(target, options) {
    let progressStarted = false;
    let operation;
    try {
      operation = await this.#setup.initialize({
        target,
        options,
        onSelectionResolved: () => {
          this.#progress.start("Инициализация Store и Project Template...");
          progressStarted = true;
        },
      });
      if (progressStarted) this.#progress.succeed("Store и Project Template проверены");
    } catch (error) {
      if (progressStarted) this.#progress.fail("Инициализация Store и Project Template: ошибка");
      throw error;
    }
    if (!operation) {
      console.log("Инициализация отменена.");
      return;
    }
    const { result, selection } = operation;
    if (result.alreadyInitialized) {
      console.log(`Store ${result.storeId} уже инициализирован.`);
      console.log(`Execution mode: ${result.executionMode}`);
      console.log(buildConnectHint(result.target, result.storeId));
      return;
    }
    console.log(`Store ${result.storeId}: ${result.target}`);
    console.log(`Agent: ${selection.agentId}`);
    console.log(`Execution mode: ${result.executionMode}`);
    printPaths("Создано", result.created);
    if (result.updated.length > 0) printPaths("Дополнено", result.updated);
    console.log(buildConnectHint(result.target, result.storeId));
  }

  async #connect(options) {
    this.#progress.start("Подключение Store и Code Repositories...");
    let result;
    try {
      this.#progress.update("Проверка native CLI выбранного Agent...");
      result = await this.#setup.connect({
        workspace: options.workspace,
        noStrict: options.strict === false,
        onProgress: (message, status) => this.#renderConnectionProgress(message, status),
      });
      this.#progress.succeed("Store и Code Repositories подключены");
    } catch (error) {
      this.#progress.fail("Подключение Store и Code Repositories: ошибка");
      throw error;
    }
    this.#printConnection(result, options);
  }

  async #diagnose({ json }) {
    const report = await this.#doctor.inspect();
    process.exitCode = report.status === "blocked" ? 1 : 0;
    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(formatDoctorReport(report).join("\n"));
  }

  async #disconnect() {
    this.#progress.start("Отключение Agent Extensions на текущей машине...");
    try {
      await this.#setup.disconnect();
      this.#progress.succeed("Agent Extensions отключены; Store config не изменён");
    } catch (error) {
      this.#progress.fail("Отключение Agent Extensions: ошибка");
      throw error;
    }
  }

  async #inspectRepositories(options) {
    const statuses = await this.#progress.run(
      "Проверка состояния repositories...",
      () => this.#repositoryStatuses.inspect({ repositoryIds: options.repo ?? [] }),
      { success: "Состояние repositories проверено" },
    );
    for (const status of statuses) printRepositoryStatus(status);
  }

  #renderConnectionProgress(message, status) {
    if (status === "success") this.#progress.succeed(message);
    else if (status === "warning") this.#progress.warn(message);
    else this.#progress.update(message);
  }

  #printConnection(result, options) {
    console.log(`Store: ${result.store_id} (${result.store_root})`);
    console.log(`Workspace: ${result.workspace}`);
    console.log(`Execution mode: ${result.execution_mode}`);
    if (options.workspace && result.execution_mode === CORE_EXECUTION_MODE.strict) {
      console.log("Workspace сохранён локально для следующих команд OpenSpec Orchestrator.");
    } else if (options.workspace) {
      console.log("Workspace использован только для текущего relaxed-вызова и не сохранён локально.");
    }
    console.log("Локальная регистрация Store проверена OpenSpec.");
    for (const repository of result.repositories) {
      console.log(formatStatusHeading(repository.repository_id, repository.status));
      console.log(`  ✓ Checkout: ${repository.cloned ? "клонирован" : "уже существовал"}`);
      console.log(`  Путь: ${repository.path}`);
      if (repository.pointer_created) {
        console.log(`  ⚠ Создан ${CORE_FILES.openSpecConfig}; требуется setup PR`);
      } else if (repository.pointer_pending) {
        console.log(`  ⚠ ${CORE_FILES.openSpecConfig} ещё не принят; требуется setup PR`);
      }
    }
    console.log(formatStatusHeading("Локальное подключение", result.status));
  }

}
