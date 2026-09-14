/** @fileoverview Read-only orchestration of Store diagnostics. */

import process from "node:process";

import { openspec } from "../openspec/openspec.js";
import { packageSupplies } from "../packages/package-supply.js";
import { repositoryStatuses } from "../project/repository-status.js";
import { storeProjects } from "../project/store-project.js";
import { hasMethods } from "../runtime/value.js";

import {
  appendDiagnostics,
  DiagnosticReport,
  DiagnosticResult,
  failedDiagnostic,
  skippedDiagnostic,
} from "./diagnostic-report.js";
import {
  extensionDiagnostic,
  groupDiagnostic,
  packageDiagnostic,
  pluginDiagnostic,
  repositoryDiagnostic,
} from "./diagnostic-mappers.js";

export { DiagnosticReport, DiagnosticResult } from "./diagnostic-report.js";

/** Aggregates existing read-only services without changing their contracts. */
export class DoctorService {
  #agentPacks;
  #extensions;
  #openspec;
  #packages;
  #plugins;
  #repositories;
  #start;
  #storeProjects;

  constructor({
    agentPackService,
    extensionStatusService,
    openSpecService = openspec,
    packageSupplyService = packageSupplies,
    pluginStatusService,
    repositoryStatusService = repositoryStatuses,
    start = process.cwd(),
    storeProjectService = storeProjects,
  } = {}) {
    if (!hasMethods(storeProjectService, ["resolve"])) {
      throw new Error("DOCTOR_INVALID: требуется StoreProjectService");
    }
    if (!hasMethods(openSpecService, ["forRepository"])) {
      throw new Error("DOCTOR_INVALID: требуется OpenSpecService");
    }
    if (!hasMethods(repositoryStatusService, ["inspect"])) {
      throw new Error("DOCTOR_INVALID: требуется RepositoryStatusService");
    }
    if (!hasMethods(packageSupplyService, ["forStore"])) {
      throw new Error("DOCTOR_INVALID: package supply должен предоставлять forStore");
    }
    if (agentPackService && !hasMethods(agentPackService, ["plan"])) {
      throw new Error("DOCTOR_INVALID: Agent Pack service должен предоставлять plan");
    }
    if (extensionStatusService && !hasMethods(extensionStatusService, ["diagnoseSelected"])) {
      throw new Error("DOCTOR_INVALID: Extension status должен предоставлять diagnoseSelected");
    }
    if (pluginStatusService && !hasMethods(pluginStatusService, ["statuses"])) {
      throw new Error("DOCTOR_INVALID: Plugin status должен предоставлять statuses");
    }
    if (typeof start !== "string") throw new Error("DOCTOR_INVALID: start должен быть строкой");
    this.#agentPacks = agentPackService;
    this.#extensions = extensionStatusService;
    this.#openspec = openSpecService;
    this.#packages = packageSupplyService;
    this.#plugins = pluginStatusService;
    this.#repositories = repositoryStatusService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async inspect({ start = this.#start, repositoryIds = [], onProgress = () => {} } = {}) {
    const checks = [];
    let storeProject;
    onProgress("Проверка Store...");
    try {
      storeProject = await this.#storeProjects.resolve(start);
      checks.push(new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }));
    } catch (error) {
      return new DiagnosticReport([
        failedDiagnostic({ id: "store", subject: "Store", fallback: "STORE_UNAVAILABLE" }, error),
        skippedDiagnostic("packages", "Store packages"),
        skippedDiagnostic("openspec", "OpenSpec"),
        skippedDiagnostic("repositories", "Repositories"),
        ...(this.#agentPacks ? [skippedDiagnostic("agent-packs", "Agent Packs")] : []),
        skippedDiagnostic("extensions", "Standalone Extensions"),
        skippedDiagnostic("plugins", "Plugins"),
      ]);
    }

    const groups = [
      ["packages", "Store packages", "PACKAGE_SUPPLY_UNAVAILABLE", () => this.#inspectPackages(storeProject)],
      ["openspec", "OpenSpec", "OPENSPEC_UNAVAILABLE", () => this.#inspectOpenSpec(storeProject)],
      ["repositories", "Repositories", "REPOSITORY_STATUS_UNAVAILABLE", () => this.#inspectRepositories(storeProject, repositoryIds)],
      ...(this.#agentPacks ? [[
        "agent-packs", "Agent Packs", "AGENT_PACK_STATUS_UNAVAILABLE",
        () => this.#inspectAgentPacks(storeProject, repositoryIds),
      ]] : []),
      ["extensions", "Standalone Extensions", "EXTENSION_STATUS_UNAVAILABLE", () => this.#inspectExtensions()],
      ["plugins", "Plugins", "PLUGIN_STATUS_UNAVAILABLE", () => this.#inspectPlugins(storeProject)],
    ];
    for (const [id, subject, fallback, inspect] of groups) {
      onProgress(`Проверка ${subject}...`);
      await appendDiagnostics(checks, { id, subject, fallback }, inspect);
    }
    return new DiagnosticReport(checks);
  }

  async #inspectPackages(storeProject) {
    return [packageDiagnostic(await this.#packages.forStore(storeProject.checkout).inspect())];
  }

  async #inspectOpenSpec(storeProject) {
    const repositoryOpenSpec = this.#openspec.forRepository(storeProject.checkout);
    const version = await repositoryOpenSpec.version();
    await repositoryOpenSpec.assertStoreHealthy();
    const warnings = [];
    const details = await repositoryOpenSpec.doctor(["doctor"], (message, severity) => {
      if (severity === "warning") warnings.push(message);
    });
    await repositoryOpenSpec.assertContext({
      storeId: storeProject.store.id,
      storeRoot: storeProject.root,
      source: "store",
      storeOption: true,
    });
    return [new DiagnosticResult({
      id: "openspec",
      subject: `OpenSpec ${version}`,
      outcome: warnings.length > 0 ? "warning" : "pass",
      ...(warnings.length > 0 ? { code: "OPENSPEC_WARNING", message: warnings.join("\n") } : {}),
      details,
    })];
  }

  async #inspectRepositories(storeProject, repositoryIds) {
    return (await this.#repositories.inspect({ start: storeProject.root, repositoryIds }))
      .map(repositoryDiagnostic);
  }

  /** Reports all Agent Pack differences but leaves every change to the user. */
  async #inspectAgentPacks(storeProject, repositoryIds) {
    const [plan, repositories] = await Promise.all([
      this.#agentPacks.plan(storeProject),
      this.#repositories.inspect({ start: storeProject.root, repositoryIds }),
    ]);
    const connected = repositories.filter(({ role, state }) => role === "code" && state === "connected");
    if (connected.length === 0) {
      return groupDiagnostic("agent-packs", "Agent Packs", "pass", "Подключённые Code Repository отсутствуют");
    }
    return Promise.all(connected.map(async ({ id, path: repositoryRoot }) => {
      const differences = await plan.inspect(repositoryRoot);
      const subject = `Agent Pack → ${id}`;
      if (Object.values(differences).every((items) => items.length === 0)) {
        return new DiagnosticResult({
          id: `agent-pack:${id}`,
          subject,
          outcome: "pass",
          message: "Commands и skills соответствуют текущему Store pack",
        });
      }
      return new DiagnosticResult({
        id: `agent-pack:${id}`,
        subject,
        outcome: "warning",
        code: "AGENT_PACK_DRIFT",
        message: "Agent Pack отличается от текущего Store. Doctor ничего не изменяет: " +
          "проверьте перечисленные пути и самостоятельно решите, что обновлять или удалять.",
        details: {
          path: repositoryRoot,
          missing: differences.missing.join(", "),
          changed: differences.changed.join(", "),
          retired: differences.retired.join(", "),
        },
      });
    }));
  }

  async #inspectExtensions() {
    if (!this.#extensions) {
      return groupDiagnostic("extensions", "Standalone Extensions", "skipped", "Extension lifecycle не настроен");
    }
    const results = await this.#extensions.diagnoseSelected();
    return results.length > 0
      ? results.map(extensionDiagnostic)
      : groupDiagnostic("extensions", "Standalone Extensions", "pass", "Подключённые standalone Extensions отсутствуют");
  }

  async #inspectPlugins(storeProject) {
    if (!this.#plugins) return groupDiagnostic("plugins", "Plugins", "skipped", "Plugin lifecycle не настроен");
    const statuses = await this.#plugins.statuses({ start: storeProject.root });
    return statuses.length > 0
      ? statuses.map(pluginDiagnostic)
      : groupDiagnostic("plugins", "Plugins", "pass", "Подключённые Plugins отсутствуют");
  }
}

/** Default Core Doctor without distribution-owned Extension and Plugin sources. */
export const doctor = Object.freeze(new DoctorService());
