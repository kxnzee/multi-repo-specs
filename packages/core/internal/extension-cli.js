/** @fileoverview CLI grammar for standalone Agent Extensions. */

import { singleValue } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";

import { formatStatusDetails, formatStatusHeading } from "./status-output.js";
import { storeProjects } from "./store-project.js";

export class ExtensionCommands {
  #extensions;
  #lifecycle;
  #output;
  #storeProjects;

  constructor({
    extensionApplication,
    extensionLifecycle,
    output = console,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof extensionApplication?.install !== "function" ||
      typeof extensionApplication?.remove !== "function" ||
      typeof extensionLifecycle?.connect !== "function" ||
      typeof extensionLifecycle?.disconnect !== "function" ||
      typeof extensionLifecycle?.remove !== "function" ||
      typeof extensionLifecycle?.statuses !== "function" ||
      typeof output?.log !== "function" ||
      typeof storeProjectService?.resolve !== "function"
    ) {
      throw new Error(
        "EXTENSION_CLI_INVALID: требуются Extension application/lifecycle и Store Project",
      );
    }
    this.#extensions = extensionApplication;
    this.#lifecycle = extensionLifecycle;
    this.#output = output;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  mount(program) {
    if (!(program instanceof Command)) {
      throw new Error("EXTENSION_CLI_INVALID: требуется Commander program");
    }
    const extension = program.command("extension")
      .description("установка standalone Agent Extensions");
    extension.command("init <extension-id>")
      .description("добавить bundled или npm Extension в Project")
      .addOption(new Option("--from <source>", "npm package, path, tarball или Git URL")
        .argParser(singleValue))
      .action((extensionId, options) => this.#install(extensionId, options.from));
    extension.command("connect <extension-id>")
      .description("установить или включить Extension в выбранном Agent")
      .action((extensionId) => this.#connect(extensionId));
    extension.command("update <extension-id>")
      .description("явно обновить внешнюю Extension и npm lock")
      .requiredOption("--from <source>", "точная npm-версия, tarball, Git commit или path")
      .action((extensionId, options) => this.#update(extensionId, options.from));
    extension.command("status [extension-id]")
      .description("проверить состояние одной или всех Extensions")
      .option("--json", "вывести machine-readable JSON")
      .action((extensionId, options) => this.#status(extensionId, Boolean(options.json)));
    extension.command("disconnect <extension-id>")
      .description("отключить Extension в выбранном Agent")
      .action((extensionId) => this.#disconnect(extensionId));
    extension.command("remove <extension-id>")
      .description("удалить Extension из Agent и Project")
      .action((extensionId) => this.#remove(extensionId));
  }

  async #install(extensionId, source) {
    const storeProject = await this.#storeProjects.resolve();
    const result = await this.#extensions.install(storeProject, extensionId, source);
    this.#output.log(result.initialized
      ? `✓ ${extensionId} — инициализирован`
      : `✓ ${extensionId} — уже инициализирован`);
  }

  async #connect(extensionId) {
    await this.#lifecycle.connect(extensionId);
    this.#output.log(`✓ ${extensionId} — подключён`);
    await this.#status(extensionId, false);
  }

  async #update(extensionId, source) {
    const storeProject = await this.#storeProjects.resolve();
    storeProject.project.requireExtension(extensionId);
    await this.#extensions.install(storeProject, extensionId, source);
    this.#output.log(`✓ ${extensionId} — обновлён; выполните openspec-orch connect`);
  }

  async #status(extensionId, json) {
    const statuses = await this.#lifecycle.statuses({ extensionId });
    if (json) {
      this.#output.log(JSON.stringify({ extensions: statuses }, null, 2));
      return;
    }
    if (statuses.length === 0) {
      this.#output.log("Extensions не найдены.");
      return;
    }
    for (const status of statuses) {
      this.#output.log(formatStatusHeading(
        `${status.extensionId} → ${status.targetId}`,
        status.state,
      ));
      for (const line of formatStatusDetails(status.output)) this.#output.log(`  ${line}`);
    }
  }

  async #disconnect(extensionId) {
    await this.#lifecycle.disconnect(extensionId);
    this.#output.log(`✓ ${extensionId} — отключён`);
  }

  async #remove(extensionId) {
    const storeProject = await this.#storeProjects.resolve();
    const result = await this.#extensions.remove(storeProject, extensionId, {
      beforeRemove: () => this.#lifecycle.remove(extensionId),
      rollbackRemove: () => this.#lifecycle.connect(extensionId),
    });
    this.#output.log(result.removed
      ? `✓ ${extensionId} — удалён`
      : `✓ ${extensionId} — не был инициализирован`);
  }
}
