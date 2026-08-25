/** @fileoverview Commander adapter Core Plugin lifecycle application service. */

import path from "node:path";
import process from "node:process";

import { checkbox } from "@inquirer/prompts";
import { createCliProgress } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";

import { collectValues, singleValue } from "./cli-values.js";
import { pluginApplications } from "./plugin-application.js";
import { PluginCatalog, pluginCatalog } from "./plugin-catalog.js";
import { pluginScaffolds } from "./plugin-scaffold.js";
import { PluginSource } from "./plugin-source.js";
import { formatStatusDetails, formatStatusHeading } from "./status-output.js";
import { storeProjects } from "./store-project.js";

/** Стабильные по ширине checkbox icons для разных terminal fonts. */
const CHECKBOX_THEME = Object.freeze({
  icon: Object.freeze({ checked: "[✓]", unchecked: "[ ]" }),
});

/** Монтирует CLI-грамматику `plugin init/connect/status/sync/exec/disconnect/remove`. */
export class PluginLifecycleCommands {
  #applications;
  #catalog;
  #checkbox;
  #lifecycle;
  #output;
  #progress;
  #scaffolds;
  #stdin;
  #stdout;
  #storeProjects;

  constructor({
    applicationService = pluginApplications,
    catalog = pluginCatalog,
    checkboxPrompt = checkbox,
    lifecycleService,
    output = console,
    progress = createCliProgress(),
    scaffoldService = pluginScaffolds,
    stdin = process.stdin,
    stdout = process.stdout,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      !applicationService ||
      typeof applicationService.install !== "function" ||
      typeof applicationService.remove !== "function"
    ) {
      throw new Error("PLUGIN_CLI_INVALID: требуется PluginApplicationService");
    }
    if (!(catalog instanceof PluginCatalog)) {
      throw new Error("PLUGIN_CLI_INVALID: требуется PluginCatalog");
    }
    if (
      !lifecycleService ||
      typeof lifecycleService.connectMany !== "function" ||
      typeof lifecycleService.disconnect !== "function" ||
      typeof lifecycleService.disconnectMany !== "function" ||
      typeof lifecycleService.exec !== "function" ||
      typeof lifecycleService.execMany !== "function" ||
      typeof lifecycleService.repositoryCandidates !== "function" ||
      typeof lifecycleService.statuses !== "function" ||
      typeof lifecycleService.sync !== "function" ||
      typeof lifecycleService.syncMany !== "function"
    ) {
      throw new Error("PLUGIN_CLI_INVALID: требуется PluginLifecycleService");
    }
    if (typeof checkboxPrompt !== "function" || typeof output?.log !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуются checkbox prompt и output");
    }
    if (!progress || typeof progress.run !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуется progress renderer");
    }
    if (!storeProjectService || typeof storeProjectService.find !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуется StoreProjectService");
    }
    if (!scaffoldService || typeof scaffoldService.register !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуется PluginScaffoldService");
    }
    this.#applications = applicationService;
    this.#catalog = catalog;
    this.#checkbox = checkboxPrompt;
    this.#lifecycle = lifecycleService;
    this.#output = output;
    this.#progress = progress;
    this.#scaffolds = scaffoldService;
    this.#stdin = stdin;
    this.#stdout = stdout;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  mount(program) {
    if (!(program instanceof Command)) {
      throw new Error("PLUGIN_CLI_INVALID: требуется Commander program");
    }
    if (program.commands.some((command) => command.name() === "plugin")) {
      throw new Error("CLI_COMMAND_CONFLICT: command path 'plugin' уже зарегистрирован");
    }
    const plugin = program.command("plugin")
      .description("инициализация, подключение и состояние CLI Plugins");
    plugin.command("register <plugin-id> [path]")
      .description("создать самостоятельный Plugin Package с готовым entrypoint")
      .addOption(new Option("--name <display-name>", "читаемое имя Plugin")
        .argParser(singleValue))
      .addOption(new Option("--support <role>", "роль Repository: store или code")
        .argParser(collectValues))
      .action((pluginId, target, options) => this.#register(pluginId, target, options));
    plugin.command("init")
      .description("выбрать Plugins из встроенного или пользовательского каталога")
      .addOption(new Option("--plugin <plugin-id>", "выбрать plugin-id без prompt")
        .argParser(collectValues))
      .addOption(new Option("--from <source>", "добавить Package, каталог, .tgz или Git URL")
        .argParser(collectValues))
      .option("--all", "выбрать все обнаруженные Plugins")
      .action((options) => this.#initialize({
        all: Boolean(options.all),
        pluginIds: options.plugin ?? [],
        sources: options.from ?? [],
      }));
    plugin.command("connect <plugin-id>")
      .description("связать Plugin с одним или несколькими repositories")
      .addOption(new Option("--repo <repository-id>", "repository-id без prompt")
        .argParser(collectValues))
      .option("--all", "применить ко всем доступным repositories без prompt")
      .action((pluginId, options) => this.#connect(pluginId, {
        all: Boolean(options.all),
        repositoryIds: options.repo ?? [],
      }));
    plugin.command("status")
      .description("показать состояние Plugin connections")
      .addOption(new Option("--plugin <plugin-id>", "ограничить одним Plugin")
        .argParser(singleValue))
      .addOption(new Option("--repo <repository-id>", "ограничить одним Repository")
        .argParser(singleValue))
      .option("--json", "вывести машиночитаемый статус")
      .action((options) => this.#status({
        json: Boolean(options.json),
        pluginId: options.plugin,
        repositoryId: options.repo,
      }));
    plugin.command("sync <plugin-id>")
      .description("синхронизировать Plugin в одном или всех связанных repositories")
      .addOption(new Option("--repo <repository-id>", "repository-id")
        .argParser(collectValues))
      .option("--all", "применить ко всем связанным repositories без prompt")
      .action((pluginId, options) => this.#sync(pluginId, {
        all: Boolean(options.all),
        repositoryIds: options.repo ?? [],
      }));
    plugin.command("exec <plugin-id> <command> [args...]")
      .description("передать command в один или все связанные Plugin instances")
      .addOption(new Option("--repo <repository-id>", "repository-id")
        .argParser(collectValues))
      .option("--all", "выполнить во всех связанных repositories без prompt")
      .action((pluginId, command, args, options) => (
        this.#exec(pluginId, {
          all: Boolean(options.all),
          repositoryIds: options.repo ?? [],
        }, [command, ...(args ?? [])])
      ));
    plugin.command("disconnect <plugin-id>")
      .description("удалить одну или все связи Plugin без очистки repository data")
      .addOption(new Option("--repo <repository-id>", "repository-id")
        .argParser(collectValues))
      .option("--all", "удалить все связи без prompt")
      .action((pluginId, options) => this.#disconnect(pluginId, {
        all: Boolean(options.all),
        repositoryIds: options.repo ?? [],
      }));
    plugin.command("remove <plugin-id>")
      .description("удалить неиспользуемый Plugin из проекта")
      .action((pluginId) => this.#remove(pluginId));
    return plugin;
  }

  async #register(pluginId, target, { name, support }) {
    const targetRoot = target ?? path.join(process.cwd(), "plugins", pluginId);
    const result = await this.#scaffolds.register({
      pluginId,
      targetRoot,
      name,
      supports: support?.length ? support : undefined,
    });
    this.#output.log(`${pluginId}: registered at ${result.root}`);
    this.#output.log(`Entrypoint: ${result.entrypoint}`);
    this.#output.log(
      `После реализации: openspec-orch plugin init --from ${result.root} --plugin ${pluginId}`,
    );
  }

  async #initialize({ all, pluginIds, sources }) {
    if (sources.length > 0) {
      if (all || pluginIds.length !== 1 || sources.length !== 1) {
        throw new Error(
          "PLUGIN_INIT_SELECTION_REQUIRED: для --from используйте один --plugin и один source",
        );
      }
      const storeProject = await this.#storeProjects.find();
      const source = PluginSource.parse(sources[0], { cwd: process.cwd() });
      await this.#installSelections(storeProject, [{ id: pluginIds[0], source }]);
      return;
    }
    let selections;
    if (all) {
      selections = this.#catalog.entries;
    } else if (pluginIds.length > 0) {
      selections = this.#catalog.select(pluginIds);
    } else {
      if (!this.#stdin?.isTTY || !this.#stdout?.isTTY) {
        throw new Error("Интерактивный выбор требует TTY; используйте --plugin, --all или --from");
      }
      const selectedIds = await this.#checkbox({
        message: "Выберите Plugins",
        theme: CHECKBOX_THEME,
        choices: this.#catalog.entries.map(({ id, name }) => ({
          name: `${name} (${id})`,
          value: id,
        })),
      });
      selections = this.#catalog.select(selectedIds);
    }
    if (selections.length === 0) {
      this.#output.log("Plugins не выбраны.");
      return;
    }
    const storeProject = await this.#storeProjects.find();
    await this.#installSelections(storeProject, selections);
  }

  async #installSelections(storeProject, selections) {
    for (const { id, source } of selections) {
      const result = await this.#progress.run(
        `Инициализация Plugin ${id}...`,
        () => this.#applications.install(storeProject, id, source),
        { success: `Plugin ${id} инициализирован` },
      );
      this.#output.log(result.initialized
        ? `✓ ${id} — инициализирован`
        : `✓ ${id} — уже инициализирован`);
    }
    this.#output.log("Далее: openspec-orch plugin connect <plugin-id>");
  }

  async #connect(pluginId, selection) {
    const repositoryIds = await this.#selectRepositories(pluginId, "connect", selection);
    if (repositoryIds.length === 0) {
      this.#output.log("Repositories не выбраны.");
      return;
    }
    const results = await this.#progress.run(
      `Подключение ${pluginId} к repositories (${repositoryIds.length})...`,
      () => this.#lifecycle.connectMany({ pluginId, repositoryIds }),
      { success: `${pluginId}: подключение завершено` },
    );
    for (const result of results) {
      this.#output.log(result.connected
        ? `✓ ${pluginId} → ${result.repositoryId} — подключён`
        : `✓ ${pluginId} → ${result.repositoryId} — уже подключён`);
      if (result.output) this.#output.log(result.output);
    }
    await this.#printCurrentStatuses(pluginId, repositoryIds);
  }

  async #status({ json, pluginId, repositoryId }) {
    const statuses = await this.#progress.run(
      "Проверка состояния Plugins...",
      () => this.#lifecycle.statuses({ pluginId, repositoryId }),
      { success: "Состояние Plugins проверено" },
    );
    if (json) {
      this.#output.log(JSON.stringify({ plugins: statuses }, null, 2));
      return;
    }
    if (statuses.length === 0) {
      this.#output.log("Подключённые Plugins не найдены.");
      return;
    }
    this.#printStatuses(statuses);
  }

  async #sync(pluginId, selection) {
    const repositoryIds = await this.#selectRepositories(pluginId, "sync", selection);
    if (repositoryIds.length === 0) {
      this.#output.log(`${pluginId}: connected repositories не найдены`);
      return;
    }
    if (repositoryIds.length === 1) {
      const [repositoryId] = repositoryIds;
      const output = await this.#progress.run(
        `Синхронизация ${pluginId} → ${repositoryId}...`,
        () => this.#lifecycle.sync({ pluginId, repositoryId }),
        { success: `${pluginId} → ${repositoryId}: синхронизирован` },
      );
      this.#output.log(`✓ ${pluginId} → ${repositoryId} — синхронизирован`);
      if (output) this.#output.log(output);
      await this.#printCurrentStatuses(pluginId, repositoryIds);
      return;
    }
    const results = await this.#progress.run(
      `Синхронизация ${pluginId} в repositories (${repositoryIds.length})...`,
      () => this.#lifecycle.syncMany({ pluginId, repositoryIds }),
      { success: `${pluginId}: синхронизация завершена` },
    );
    this.#printMany(pluginId, results, "synced");
    await this.#printCurrentStatuses(pluginId, repositoryIds);
  }

  async #exec(pluginId, selection, args) {
    const repositoryIds = await this.#selectRepositories(pluginId, "exec", selection);
    if (repositoryIds.length === 0) {
      this.#output.log(`${pluginId}: connected repositories не найдены`);
      return;
    }
    if (repositoryIds.length === 1) {
      const output = await this.#progress.run(
        `Выполнение ${pluginId} → ${repositoryIds[0]}...`,
        () => this.#lifecycle.exec({
          args,
          pluginId,
          repositoryId: repositoryIds[0],
        }),
        { success: `${pluginId} → ${repositoryIds[0]}: команда завершена` },
      );
      if (output) this.#output.log(output);
      return;
    }
    const results = await this.#progress.run(
      `Выполнение ${pluginId} в repositories (${repositoryIds.length})...`,
      () => this.#lifecycle.execMany({ args, pluginId, repositoryIds }),
      { success: `${pluginId}: команда завершена` },
    );
    this.#printMany(pluginId, results, "executed");
  }

  async #disconnect(pluginId, selection) {
    const repositoryIds = await this.#selectRepositories(pluginId, "disconnect", selection);
    if (repositoryIds.length === 0) {
      this.#output.log(`${pluginId}: connected repositories не найдены`);
      return;
    }
    if (repositoryIds.length === 1) {
      const [repositoryId] = repositoryIds;
      const result = await this.#progress.run(
        `Отключение ${pluginId} → ${repositoryId}...`,
        () => this.#lifecycle.disconnect({ pluginId, repositoryId }),
        { success: `${pluginId} → ${repositoryId}: отключение завершено` },
      );
      this.#output.log(result.disconnected
        ? `✓ ${pluginId} → ${repositoryId} — отключён`
        : `• ${pluginId} → ${repositoryId} — не был подключён`);
      return;
    }
    const results = await this.#progress.run(
      `Отключение ${pluginId} от repositories (${repositoryIds.length})...`,
      () => this.#lifecycle.disconnectMany({ pluginId, repositoryIds }),
      { success: `${pluginId}: отключение завершено` },
    );
    for (const result of results) {
      this.#output.log(result.disconnected
        ? `✓ ${pluginId} → ${result.repositoryId} — отключён`
        : `• ${pluginId} → ${result.repositoryId} — не был подключён`);
    }
  }

  async #selectRepositories(pluginId, operation, { all, repositoryIds }) {
    if (all && repositoryIds.length > 0) {
      throw new Error("PLUGIN_REPOSITORY_SELECTION_INVALID: --all и --repo нельзя использовать вместе");
    }
    if (repositoryIds.length > 0) return Object.freeze([...new Set(repositoryIds)]);
    if (!all && (!this.#stdin?.isTTY || !this.#stdout?.isTTY)) {
      throw new Error("Интерактивный выбор требует TTY; используйте --repo или --all");
    }
    const candidates = await this.#lifecycle.repositoryCandidates({ pluginId, operation });
    if (all || candidates.length === 0) {
      return Object.freeze(candidates.map(({ id }) => id));
    }
    const messages = {
      connect: `Подключить ${pluginId} к repositories`,
      disconnect: `Отключить ${pluginId} от repositories`,
      exec: `Выполнить команду ${pluginId} в repositories`,
      sync: `Синхронизировать ${pluginId} в repositories`,
    };
    return this.#checkbox({
      message: messages[operation],
      theme: CHECKBOX_THEME,
      choices: candidates.map(({ id, role }) => ({
        name: `${id} [${role}]`,
        value: id,
      })),
    });
  }

  #printMany(pluginId, results, state) {
    if (results.length === 0) {
      this.#output.log(`${pluginId}: connected repositories не найдены`);
      return;
    }
    for (const result of results) {
      this.#output.log(state === "synced"
        ? `✓ ${pluginId} → ${result.repositoryId} — синхронизирован`
        : `✓ ${pluginId} → ${result.repositoryId} — команда выполнена`);
      if (result.output) this.#output.log(result.output);
    }
  }

  async #printCurrentStatuses(pluginId, repositoryIds) {
    const groups = await this.#progress.run(
      `Проверка актуального состояния ${pluginId}...`,
      () => Promise.all(repositoryIds.map((repositoryId) => (
        this.#lifecycle.statuses({ pluginId, repositoryId })
      ))),
      { success: `${pluginId}: актуальное состояние проверено` },
    );
    this.#printStatuses(groups.flat());
  }

  #printStatuses(statuses) {
    for (const status of statuses) {
      this.#output.log(formatStatusHeading(
        `${status.pluginId} → ${status.repositoryId}`,
        status.state,
      ));
      for (const line of formatStatusDetails(status.output)) this.#output.log(`  ${line}`);
    }
  }

  async #remove(pluginId) {
    const storeProject = await this.#storeProjects.find();
    const result = await this.#progress.run(
      `Удаление Plugin ${pluginId}...`,
      () => this.#applications.remove(storeProject, pluginId),
      { success: `Plugin ${pluginId}: удаление завершено` },
    );
    this.#output.log(result.removed
      ? `✓ ${pluginId} — удалён`
      : `• ${pluginId} — не был инициализирован`);
  }
}
