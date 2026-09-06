/** @fileoverview CLI grammar for Store-scoped npm package supply. */

import { Command } from "commander";

import { packageSupplies } from "./package-supply.js";
import { formatStatusHeading } from "./status-output.js";
import { storeProjects } from "./store-project.js";

export class PackageCommands {
  #output;
  #supplies;
  #storeProjects;

  constructor({
    output = console,
    supplyService = packageSupplies,
    storeProjectService = storeProjects,
  } = {}) {
    if (
      typeof output?.log !== "function" ||
      typeof supplyService?.forStore !== "function" ||
      typeof storeProjectService?.resolve !== "function"
    ) {
      throw new Error("PACKAGE_CLI_INVALID: требуются package supply и Store Project");
    }
    this.#output = output;
    this.#supplies = supplyService;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  mount(program) {
    if (!(program instanceof Command)) throw new Error("PACKAGE_CLI_INVALID: требуется Commander program");
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
