/** @fileoverview CLI для standalone Extensions и npm lockfile sync. */

import { singleValue } from "@openspec-orch/plugin-sdk";
import { Command, Option } from "commander";

import { packageSupplies } from "./package-supply.js";
import { formatStatusDetails, formatStatusHeading } from "./status-output.js";
import { storeProjects } from "./store-project.js";

export class PackageCommands {
  #extensions;
  #lifecycle;
  #output;
  #supplies;
  #storeProjects;

  constructor({
    extensionApplication,
    extensionLifecycle,
    output = console,
    supplyService = packageSupplies,
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
      typeof supplyService?.forStore !== "function" ||
      typeof storeProjectService?.resolve !== "function"
    ) {
      throw new Error(
        "PACKAGE_CLI_INVALID: требуются Extension application/lifecycle, supply и Store Project",
      );
    }
    this.#extensions = extensionApplication;
    this.#lifecycle = extensionLifecycle;
    this.#output = output;
    this.#supplies = supplyService;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  mount(program) {
    if (!(program instanceof Command)) throw new Error("PACKAGE_CLI_INVALID: требуется Commander program");
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
      .action((extensionId, options) => this.#updateExtension(extensionId, options.from));
    extension.command("status [extension-id]")
      .description("проверить состояние одной или всех Extensions")
      .option("--json", "вывести machine-readable JSON")
      .action((extensionId, options) => this.#extensionStatus(extensionId, Boolean(options.json)));
    extension.command("disconnect <extension-id>")
      .description("отключить Extension в выбранном Agent")
      .action((extensionId) => this.#disconnect(extensionId));
    extension.command("remove <extension-id>")
      .description("удалить Extension из Agent и Project")
      .action((extensionId) => this.#remove(extensionId));
    const packages = program.command("package")
      .description("управление общим npm package supply Store");
    packages.command("sync")
      .description("восстановить Store packages строго из package-lock.json")
      .action(() => this.#sync());
    packages.command("status")
      .description("проверить npm lock, provenance и локальный runtime без изменений")
      .option("--json", "вывести machine-readable JSON")
      .action((options) => this.#packageStatus(Boolean(options.json)));
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
    await this.#extensionStatus(extensionId, false);
  }

  async #updateExtension(extensionId, source) {
    const storeProject = await this.#storeProjects.resolve();
    storeProject.project.requireExtension(extensionId);
    await this.#extensions.install(storeProject, extensionId, source);
    this.#output.log(`✓ ${extensionId} — обновлён; выполните openspec-orch connect`);
  }

  async #extensionStatus(extensionId, json) {
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

  async #sync() {
    const storeProject = await this.#storeProjects.resolve();
    const synchronized = await this.#supplies.forStore(storeProject.checkout).sync();
    this.#output.log(synchronized
      ? "✓ Store packages восстановлены из package-lock.json"
      : "✓ Внешних Store packages нет");
  }

  async #packageStatus(json) {
    const storeProject = await this.#storeProjects.resolve();
    const report = await this.#supplies.forStore(storeProject.checkout).inspect();
    if (json) {
      this.#output.log(JSON.stringify(report, null, 2));
      return;
    }
    const displayState = report.state === "absent"
      ? "complete"
      : report.state === "missing" ? "unavailable" : report.state;
    this.#output.log(formatStatusHeading("Store packages", displayState));
    this.#output.log(`  Runtime: ${report.runtimeRoot}`);
    if (report.packages.length === 0) {
      this.#output.log("  Внешние packages отсутствуют.");
      return;
    }
    for (const entry of report.packages) {
      const state = entry.available ? entry.provenance : "missing";
      this.#output.log(`  ${entry.kind}/${entry.id}: ${entry.packageName}@${entry.version ?? entry.requested} [${state}]`);
    }
  }
}
