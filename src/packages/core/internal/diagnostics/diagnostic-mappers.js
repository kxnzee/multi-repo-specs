/** @fileoverview Преобразование результатов доменных проверок в Doctor checks. */

import { DiagnosticResult } from "./diagnostic-report.js";

/** Maps one read-only RepositoryStatus into Doctor semantics. */
export function repositoryDiagnostic(status) {
  const subject = `Repository ${status.id} [${status.role}]`;
  const details = Object.fromEntries(Object.entries({
    state: status.state,
    path: status.path,
    branch: status.branch,
    remote: status.remote,
    remote_matches: status.remoteMatches,
    clean: status.clean,
    error: status.error,
  }).filter(([, value]) => value !== undefined));
  if (status.state === "connected") {
    return new DiagnosticResult({
      id: `repository:${status.id}`,
      subject,
      outcome: status.clean === false ? "warning" : "pass",
      details,
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
    message: status.error ?? `Repository находится в состоянии ${status.state}`,
    details,
  });
}

/** Maps one existing PluginStatusResult into Doctor semantics. */
export function pluginDiagnostic(status) {
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
export function extensionDiagnostic(status) {
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
export function groupDiagnostic(id, subject, outcome, message) {
  return [new DiagnosticResult({ id, subject, outcome, message })];
}

/** Maps the read-only npm supply report into one stable Doctor check. */
export function packageDiagnostic(report) {
  const total = report.packages.length;
  const details = {
    state: report.state,
    packages: total,
    available: report.available,
    mutable: report.mutable,
    runtime: report.runtimeRoot,
  };
  if (report.state === "missing") {
    return new DiagnosticResult({
      id: "packages",
      subject: "Store packages",
      outcome: "error",
      code: "PACKAGE_RUNTIME_UNAVAILABLE",
      message: "Выполните openspec-orch package sync",
      details,
    });
  }
  if (report.state === "stale") {
    return new DiagnosticResult({
      id: "packages",
      subject: "Store packages",
      outcome: "warning",
      code: "PACKAGE_RUNTIME_STALE",
      message: "Установленная версия не совпадает с package-lock; выполните openspec-orch package sync",
      details,
    });
  }
  if (report.mutable > 0) {
    return new DiagnosticResult({
      id: "packages",
      subject: "Store packages",
      outcome: "warning",
      code: "PACKAGE_SOURCE_MUTABLE",
      message: "Источник пакета изменяемый; для воспроизводимости используйте фиксированную версию или commit",
      details,
    });
  }
  return new DiagnosticResult({
    id: "packages",
    subject: "Store packages",
    outcome: "pass",
    message: total === 0 ? "Внешние packages отсутствуют" : "npm lock и runtime согласованы",
    details,
  });
}
