/** @fileoverview Commander adapter Core Plugin lifecycle application service. */

import process from "node:process";

import { checkbox } from "@inquirer/prompts";
import { Command, Option } from "commander";

import { collectValues, singleValue } from "./cli-values.js";
import { storeProjects } from "./store-project.js";

/** Монтирует неизменную CLI-грамматику `plugin connect/status/sync`. */
export class PluginLifecycleCommands {
  #checkbox;
  #lifecycle;
  #output;
  #stdin;
  #stdout;
  #storeProjects;

  constructor({
    checkboxPrompt = checkbox,
    lifecycleService,
    output = console,
    stdin = process.stdin,
    stdout = process.stdout,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      !lifecycleService ||
      typeof lifecycleService.connectMany !== "function" ||
      typeof lifecycleService.statuses !== "function" ||
      typeof lifecycleService.sync !== "function"
    ) {
      throw new Error("PLUGIN_CLI_INVALID: требуется PluginLifecycleService");
    }
    if (typeof checkboxPrompt !== "function" || typeof output?.log !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуются checkbox prompt и output");
    }
    if (!storeProjectService || typeof storeProjectService.find !== "function") {
      throw new Error("PLUGIN_CLI_INVALID: требуется StoreProjectService");
    }
    this.#checkbox = checkboxPrompt;
    this.#lifecycle = lifecycleService;
    this.#output = output;
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
    plugin.command("connect <plugin-id>")
      .description("связать Plugin с одним или несколькими repositories")
      .addOption(new Option("--repo <repository-id>", "repository-id без prompt")
        .argParser(collectValues))
      .action((pluginId, options) => this.#connect(pluginId, options.repo ?? []));
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
      .description("синхронизировать Plugin в связанном Repository")
      .addOption(new Option("--repo <repository-id>", "repository-id")
        .argParser(singleValue).makeOptionMandatory())
      .action((pluginId, options) => this.#sync(pluginId, options.repo));
    return plugin;
  }

  async #connect(pluginId, requestedRepositoryIds) {
    let repositoryIds = requestedRepositoryIds;
    if (repositoryIds.length === 0) {
      if (!this.#stdin?.isTTY || !this.#stdout?.isTTY) {
        throw new Error("Интерактивный выбор требует TTY; используйте явные --plugin и --repo");
      }
      const { project } = await this.#storeProjects.find();
      project.requirePlugin(pluginId);
      repositoryIds = await this.#checkbox({
        message: `Подключить ${pluginId} к repositories`,
        choices: project.repositories.map(({ id, role }) => ({
          name: `${id} [${role}]`,
          value: id,
        })),
      });
    }
    if (repositoryIds.length === 0) {
      this.#output.log("Repositories не выбраны.");
      return;
    }
    const results = await this.#lifecycle.connectMany({ pluginId, repositoryIds });
    for (const result of results) {
      this.#output.log(
        `${pluginId} -> ${result.repositoryId}: ` +
          (result.connected ? "connected" : "already_connected"),
      );
      if (result.output) this.#output.log(result.output);
    }
  }

  async #status({ json, pluginId, repositoryId }) {
    const statuses = await this.#lifecycle.statuses({ pluginId, repositoryId });
    if (json) {
      this.#output.log(JSON.stringify({ plugins: statuses }, null, 2));
      return;
    }
    if (statuses.length === 0) {
      this.#output.log("Подключённые Plugins не найдены.");
      return;
    }
    for (const status of statuses) {
      this.#output.log(`${status.pluginId} -> ${status.repositoryId}: ${status.state}`);
      if (status.output) this.#output.log(`  ${status.output.replaceAll("\n", "\n  ")}`);
    }
  }

  async #sync(pluginId, repositoryId) {
    const output = await this.#lifecycle.sync({ pluginId, repositoryId });
    this.#output.log(`${pluginId} -> ${repositoryId}: synced`);
    if (output) this.#output.log(output);
  }
}
