/** @fileoverview Candidate CLI composition для перенесённых Core operations. */

import path from "node:path";
import process from "node:process";

import { collectValues, createCliProgress, singleValue } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";

import { isBundledTemplateProvider } from "./bundled-template.js";
import { configuration } from "./configuration.js";
import { CORE_EXECUTION_MODE, CORE_FILES } from "./constants.js";
import { connection } from "./connection.js";
import { doctor } from "./doctor.js";
import { initSelections } from "./init-selection.js";
import { initialization } from "./initialization.js";
import { repositoryStatuses } from "./repository-status.js";
import { hasMethods } from "./value.js";
import { formatDoctorReport, formatStatusHeading } from "./status-output.js";
import { workspace } from "./workspace.js";

const LEGACY_TEMPLATE_ID = "base";

/** Собирает provider для старого constructor contract с одним templateRoot. */
function legacyTemplateProvider(templateRoot) {
  return Object.freeze({
    defaultId: LEGACY_TEMPLATE_ID,
    catalog: Object.freeze({ entries: Object.freeze([]) }),
    resolve(templateId) {
      if (templateId === LEGACY_TEMPLATE_ID && typeof templateRoot === "string") {
        return Object.freeze({ id: LEGACY_TEMPLATE_ID, root: templateRoot });
      }
      throw new Error(`TEMPLATE_NOT_DISCOVERED: template-id '${templateId ?? ""}' не найден`);
    },
  });
}

/** Отличает явный local path от стабильного bundled Template ID. */
function isLocalTemplateRequest(request) {
  return path.isAbsolute(request) || request.startsWith(".") ||
    request.includes("/") || request.includes("\\");
}

/** Разрешает один нормализованный Template request без catch-based control flow. */
function resolveTemplateRequest(provider, request) {
  return isLocalTemplateRequest(request)
    ? Object.freeze({ id: undefined, root: request })
    : provider.resolve(request);
}

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
  #bundledTemplates;
  #connection;
  #doctor;
  #extensionPreflight;
  #extensions;
  #initSelection;
  #initialization;
  #pluginCommands;
  #pluginLifecycleCommands;
  #progress;
  #repositoryStatuses;

  constructor({
    bundledTemplateProvider,
    connectionService = connection,
    doctorService = doctor,
    extensionLifecycle,
    initSelectionService = initSelections,
    initializationService = initialization,
    pluginCommandMounter,
    pluginExtensionConnector,
    pluginLifecycleCommands,
    progress = createCliProgress(),
    repositoryStatusService = repositoryStatuses,
    templateRoot,
  } = {}) {
    const resolvedTemplates = bundledTemplateProvider ?? legacyTemplateProvider(templateRoot);
    if (!isBundledTemplateProvider(resolvedTemplates)) {
      throw new Error(
        "CLI_INVALID: bundledTemplateProvider должен предоставлять defaultId, catalog и resolve",
      );
    }
    this.#bundledTemplates = resolvedTemplates;
    this.#connection = connectionService;
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
    this.#extensionPreflight = extensionLifecycle;
    if (typeof initSelectionService?.resolve !== "function") {
      throw new Error("CLI_INVALID: initSelectionService должен предоставлять resolve");
    }
    this.#initSelection = initSelectionService;
    this.#initialization = initializationService;
    if (pluginCommandMounter && typeof pluginCommandMounter.mount !== "function") {
      throw new Error("CLI_INVALID: pluginCommandMounter должен предоставлять mount");
    }
    this.#pluginCommands = pluginCommandMounter;
    if (pluginExtensionConnector && !hasMethods(
      pluginExtensionConnector,
      ["connectSelected", "disconnectSelected", "statusSelected"],
    )) {
      throw new Error(
        "CLI_INVALID: pluginExtensionConnector должен предоставлять connectSelected, " +
          "statusSelected и disconnectSelected",
      );
    }
    this.#extensions = Object.freeze(
      [extensionLifecycle, pluginExtensionConnector].filter(Boolean),
    );
    if (pluginLifecycleCommands && typeof pluginLifecycleCommands.mount !== "function") {
      throw new Error("CLI_INVALID: pluginLifecycleCommands должен предоставлять mount");
    }
    this.#pluginLifecycleCommands = pluginLifecycleCommands;
    if (!hasMethods(progress, ["fail", "run", "start", "succeed", "update", "warn"])) {
      throw new Error("CLI_INVALID: progress должен предоставлять renderer contract");
    }
    this.#progress = progress;
    this.#repositoryStatuses = repositoryStatusService;
    Object.freeze(this);
  }

  createProgram() {
    const program = new Command()
      .name("openspec-orch")
      .description("OpenSpec Orchestrator для multi-repository OpenSpec workflow")
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
    this.#pluginLifecycleCommands?.mount(program);
    const repository = program.command("repository")
      .description("операции только чтения над репозиториями реестра");
    repository.command("status")
      .description("показать подключение, чистоту, remote и ветку каждого репозитория")
      .addOption(new Option("--repo <repository-id>", "ограничить вывод одним repository-id")
        .argParser(collectValues))
      .action((options) => this.#inspectRepositories(options));
    this.#pluginCommands?.mount(program);
    return program;
  }

  async #initialize(target, options) {
    const selection = await this.#initSelection.resolve(options);
    if (!selection) {
      console.log("Инициализация отменена.");
      return;
    }
    const templateRequest = selection.template ?? this.#bundledTemplates.defaultId;
    const template = resolveTemplateRequest(this.#bundledTemplates, templateRequest);
    const result = await this.#progress.run(
      "Инициализация Store и Project Template...",
      () => this.#initialization.initialize({
        target,
        storeId: selection.storeId,
        agentId: selection.agentId,
        extensions: selection.extensions,
        replaceExtensions: selection.extensionsSpecified,
        templateId: template.id,
        templateRoot: template.root,
        repositories: selection.repositories,
        noStrict: selection.noStrict,
      }),
      { success: "Store и Project Template проверены" },
    );
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
      await this.#extensionPreflight?.preflight();
      result = await this.#connection.connect({
        workspace: options.workspace,
        noStrict: options.strict === false,
        onProgress: (message, status) => this.#renderConnectionProgress(message, status),
      });
      this.#progress.update("Подключение выбранных Extensions...");
      for (const lifecycle of this.#extensions) await lifecycle.connectSelected();
      this.#progress.update("Проверка состояния Extensions и Plugins...");
      for (const lifecycle of this.#extensions) await lifecycle.statusSelected();
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
      for (const lifecycle of [...this.#extensions].reverse()) {
        await lifecycle.disconnectSelected();
      }
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
    console.log(`Store: ${result.storeId} (${result.storeRoot})`);
    console.log(`Workspace: ${result.workspace}`);
    console.log(`Execution mode: ${result.executionMode}`);
    if (options.workspace && result.executionMode === CORE_EXECUTION_MODE.strict) {
      console.log("Workspace сохранён локально для следующих команд OpenSpec Orchestrator.");
    } else if (options.workspace) {
      console.log("Workspace использован только для текущего relaxed-вызова и не сохранён локально.");
    }
    console.log("Локальная регистрация Store проверена OpenSpec.");
    for (const repository of result.repositories) {
      console.log(formatStatusHeading(repository.id, repository.status));
      console.log(`  ✓ Checkout: ${repository.cloned ? "клонирован" : "уже существовал"}`);
      console.log(`  Путь: ${repository.path}`);
      if (repository.pointerCreated) {
        console.log(`  ⚠ Создан ${CORE_FILES.openSpecConfig}; требуется setup PR`);
      } else if (repository.pointerPending) {
        console.log(`  ⚠ ${CORE_FILES.openSpecConfig} ещё не принят; требуется setup PR`);
      }
    }
    console.log(formatStatusHeading("Локальное подключение", result.status));
  }

}
