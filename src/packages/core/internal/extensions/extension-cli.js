/** @fileoverview CLI grammar for standalone Agent Extensions. */

import { createCliProgress, singleValue } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";
import path from "node:path";
import process from "node:process";

import { formatStatusDetails, formatStatusHeading } from "../cli/status-output.js";
import { storeProjects } from "../project/store-project.js";

export class ExtensionCommands {
  #cwd;
  #extensions;
  #lifecycle;
  #output;
  #progress;
  #storeProjects;

  constructor({
    cwd = process.cwd(),
    extensionApplication,
    extensionLifecycle,
    output = console,
    progress = createCliProgress(),
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof cwd !== "string" ||
      !path.isAbsolute(cwd) ||
      typeof extensionApplication?.install !== "function" ||
      typeof extensionApplication?.remove !== "function" ||
      typeof extensionLifecycle?.connect !== "function" ||
      typeof extensionLifecycle?.disconnect !== "function" ||
      typeof extensionLifecycle?.remove !== "function" ||
      typeof extensionLifecycle?.statuses !== "function" ||
      typeof output?.log !== "function" ||
      typeof progress?.run !== "function" ||
      typeof storeProjectService?.resolve !== "function"
    ) {
      throw new Error(
        "EXTENSION_CLI_INVALID: требуются Extension application/lifecycle и Store Project",
      );
    }
    this.#cwd = cwd;
    this.#extensions = extensionApplication;
    this.#lifecycle = extensionLifecycle;
    this.#output = output;
    this.#progress = progress;
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
      .option("--refresh", "явно обновить нативную установку")
      .action((extensionId, options) => this.#connect(extensionId, Boolean(options.refresh)));
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
    const result = await this.#extensions.install(
      storeProject,
      extensionId,
      this.#resolveSource(source),
    );
    this.#output.log(result.initialized
      ? `✓ ${extensionId} — инициализирован`
      : `✓ ${extensionId} — уже инициализирован`);
  }

  async #connect(extensionId, refresh) {
    const action = refresh ? "Обновление и подключение" : "Подключение";
    await this.#progress.run(
      `${action} Extension ${extensionId}...`,
      () => this.#lifecycle.connect(extensionId, { refresh }),
      {
        failure: `${action} Extension ${extensionId}: ошибка`,
        success: `Extension ${extensionId} ${refresh ? "обновлён и подключён" : "подключён"}`,
      },
    );
    await this.#status(extensionId, false);
  }

  async #update(extensionId, source) {
    const storeProject = await this.#storeProjects.resolve();
    storeProject.project.requireExtension(extensionId);
    await this.#extensions.install(storeProject, extensionId, this.#resolveSource(source));
    this.#output.log(`✓ ${extensionId} — обновлён; выполните openspec-orch extension connect ${extensionId} --refresh`);
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

  #resolveSource(source) {
    return source?.startsWith(".") ? path.resolve(this.#cwd, source) : source;
  }
}
