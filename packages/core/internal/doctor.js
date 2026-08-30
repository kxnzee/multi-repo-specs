/** @fileoverview Read-only aggregate diagnostics for one Store and local machine. */

import process from "node:process";

import { openspec } from "./openspec.js";
import { repositoryStatuses } from "./repository-status.js";
import { storeProjects } from "./store-project.js";
import { hasMethods } from "./value.js";

const OUTCOMES = new Set(["pass", "warning", "error", "skipped"]);

/** Returns a stable diagnostic code from a domain error or a caller fallback. */
function diagnosticCode(error, fallback) {
  if (typeof error?.code === "string" && error.code.length > 0) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^([A-Z][A-Z0-9_]+):/u)?.[1] ?? fallback;
}

/** Returns a stable message even for a non-Error throw. */
function diagnosticMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Creates one failed check from a caught domain error. */
function failed({ id, subject, fallback }, error) {
  return new DiagnosticResult({
    id,
    subject,
    outcome: "error",
    code: diagnosticCode(error, fallback),
    message: diagnosticMessage(error),
  });
}

/** Appends one independent diagnostic group without interrupting later groups. */
async function appendDiagnostics(checks, failure, inspect) {
  try {
    checks.push(...await inspect());
  } catch (error) {
    checks.push(failed(failure, error));
  }
}

/** Immutable result of one Doctor check. */
export class DiagnosticResult {
  #value;

  constructor({ id, subject, outcome, code = "", message = "", details = "" } = {}) {
    if (
      typeof id !== "string" || id.length === 0 ||
      typeof subject !== "string" || subject.length === 0 ||
      !OUTCOMES.has(outcome) ||
      [code, message, details].some((value) => typeof value !== "string")
    ) {
      throw new Error("DIAGNOSTIC_RESULT_INVALID: некорректный Doctor check");
    }
    this.#value = Object.freeze({ id, subject, outcome, code, message, details });
    Object.freeze(this);
  }

  get id() { return this.#value.id; }
  get subject() { return this.#value.subject; }
  get outcome() { return this.#value.outcome; }
  get code() { return this.#value.code; }
  get message() { return this.#value.message; }
  get details() { return this.#value.details; }

  toJSON() {
    return this.#value;
  }
}

/** Immutable complete Doctor report. */
export class DiagnosticReport {
  #checks;
  #status;
  #summary;

  constructor(checks = []) {
    if (!Array.isArray(checks) || checks.some((check) => !(check instanceof DiagnosticResult))) {
      throw new Error("DIAGNOSTIC_REPORT_INVALID: checks должны содержать DiagnosticResult");
    }
    this.#checks = Object.freeze([...checks]);
    const summary = { pass: 0, warning: 0, error: 0, skipped: 0 };
    for (const { outcome } of checks) summary[outcome] += 1;
    this.#summary = Object.freeze(summary);
    this.#status = summary.error > 0
      ? "blocked"
      : summary.warning > 0 || summary.skipped > 0 ? "degraded" : "ready";
    Object.freeze(this);
  }

  get checks() { return this.#checks; }
  get status() { return this.#status; }
  get summary() { return this.#summary; }

  toJSON() {
    return Object.freeze({
      version: 1,
      status: this.#status,
      summary: this.#summary,
      checks: Object.freeze(this.#checks.map((check) => check.toJSON())),
    });
  }
}

/** Creates one skipped dependent check after Store resolution failed. */
function skipped(id, subject) {
  return new DiagnosticResult({
    id,
    subject,
    outcome: "skipped",
    code: "STORE_UNAVAILABLE",
    message: "Проверка требует доступный Store",
  });
}

/** Maps one read-only RepositoryStatus into Doctor semantics. */
function repositoryDiagnostic(status) {
  const subject = `Repository ${status.id} [${status.role}]`;
  if (status.state === "connected") {
    return new DiagnosticResult({
      id: `repository:${status.id}`,
      subject,
      outcome: status.clean === false ? "warning" : "pass",
      ...(status.clean === false ? {
        code: "REPOSITORY_DIRTY",
        message: "Рабочее дерево содержит изменения",
      } : {}),
    });
  }
  return new DiagnosticResult({
    id: `repository:${status.id}`,
    subject,
    outcome: "error",
    code: `REPOSITORY_${status.state.toUpperCase()}`,
    message: `Repository находится в состоянии ${status.state}`,
  });
}

/** Maps one existing PluginStatusResult into Doctor semantics. */
function pluginDiagnostic(status) {
  const outcome = status.state === "ready" ? "pass" : status.state === "stale" ? "warning" : "error";
  return new DiagnosticResult({
    id: `plugin:${status.pluginId}:${status.repositoryId}`,
    subject: `Plugin ${status.pluginId} → ${status.repositoryId}`,
    outcome,
    ...(outcome === "pass" ? {} : { code: `PLUGIN_${status.state.toUpperCase()}` }),
    message: status.output ?? "",
  });
}

/** Maps one independent Extension diagnostic into Doctor semantics. */
function extensionDiagnostic(status) {
  const ready = status.state === "ready";
  return new DiagnosticResult({
    id: `extension:${status.extensionId}:${status.targetId}`,
    subject: `Extension ${status.extensionId} → ${status.targetId}`,
    outcome: ready ? "pass" : "error",
    ...(ready ? {} : { code: "EXTENSION_UNAVAILABLE" }),
    message: status.output ?? "",
  });
}

/** Creates a single aggregate check for an empty or unavailable group. */
function groupDiagnostic(id, subject, outcome, message) {
  return [new DiagnosticResult({ id, subject, outcome, message })];
}

/** Aggregates existing read-only services without changing their contracts. */
export class DoctorService {
  #extensions;
  #openspec;
  #plugins;
  #repositories;
  #start;
  #storeProjects;

  constructor({
    extensionStatusService,
    openSpecService = openspec,
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
    if (extensionStatusService && !hasMethods(extensionStatusService, ["diagnoseSelected"])) {
      throw new Error("DOCTOR_INVALID: Extension status должен предоставлять diagnoseSelected");
    }
    if (pluginStatusService && !hasMethods(pluginStatusService, ["statuses"])) {
      throw new Error("DOCTOR_INVALID: Plugin status должен предоставлять statuses");
    }
    if (typeof start !== "string") throw new Error("DOCTOR_INVALID: start должен быть строкой");
    this.#extensions = extensionStatusService;
    this.#openspec = openSpecService;
    this.#plugins = pluginStatusService;
    this.#repositories = repositoryStatusService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async inspect({ start = this.#start } = {}) {
    const checks = [];
    let storeProject;
    try {
      storeProject = await this.#storeProjects.resolve(start);
      checks.push(new DiagnosticResult({ id: "store", subject: "Store", outcome: "pass" }));
    } catch (error) {
      return new DiagnosticReport([
        failed({ id: "store", subject: "Store", fallback: "STORE_UNAVAILABLE" }, error),
        skipped("openspec", "OpenSpec"),
        skipped("repositories", "Repositories"),
        skipped("extensions", "Standalone Extensions"),
        skipped("plugins", "Plugins"),
      ]);
    }

    const groups = [
      ["openspec", "OpenSpec", "OPENSPEC_UNAVAILABLE", () => this.#inspectOpenSpec(storeProject)],
      [
        "repositories", "Repositories", "REPOSITORY_STATUS_UNAVAILABLE",
        () => this.#inspectRepositories(storeProject),
      ],
      [
        "extensions", "Standalone Extensions", "EXTENSION_STATUS_UNAVAILABLE",
        () => this.#inspectExtensions(),
      ],
      ["plugins", "Plugins", "PLUGIN_STATUS_UNAVAILABLE", () => this.#inspectPlugins(storeProject)],
    ];
    for (const [id, subject, fallback, inspect] of groups) {
      await appendDiagnostics(checks, { id, subject, fallback }, inspect);
    }
    return new DiagnosticReport(checks);
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
      ...(warnings.length > 0 ? {
        code: "OPENSPEC_WARNING",
        message: warnings.join("\n"),
      } : {}),
      details,
    })];
  }

  async #inspectRepositories(storeProject) {
    return (await this.#repositories.inspect({ start: storeProject.root }))
      .map(repositoryDiagnostic);
  }

  async #inspectExtensions() {
    if (!this.#extensions) {
      return groupDiagnostic(
        "extensions", "Standalone Extensions", "skipped", "Extension lifecycle не настроен",
      );
    }
    const results = await this.#extensions.diagnoseSelected();
    return results.length > 0
      ? results.map(extensionDiagnostic)
      : groupDiagnostic(
        "extensions", "Standalone Extensions", "pass",
        "Подключённые standalone Extensions отсутствуют",
      );
  }

  async #inspectPlugins(storeProject) {
    if (!this.#plugins) {
      return groupDiagnostic("plugins", "Plugins", "skipped", "Plugin lifecycle не настроен");
    }
    const statuses = await this.#plugins.statuses({ start: storeProject.root });
    return statuses.length > 0
      ? statuses.map(pluginDiagnostic)
      : groupDiagnostic("plugins", "Plugins", "pass", "Подключённые Plugins отсутствуют");
  }
}

/** Default Core Doctor without distribution-owned Extension and Plugin sources. */
export const doctor = Object.freeze(new DoctorService());
