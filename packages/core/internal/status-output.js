/** @fileoverview Dependency-free human presentation for Core status commands. */

import { STATUS_PRESENTATIONS } from "./status-output-config.js";

const doctorPresentation = (icon, label) => Object.freeze({ icon, label });
const DOCTOR_PRESENTATIONS = Object.freeze({
  pass: doctorPresentation("✓", "Успешно"),
  warning: doctorPresentation("⚠", "Предупреждения"),
  error: doctorPresentation("✗", "Ошибки"),
  skipped: doctorPresentation("•", "Пропущено"),
});

const DOCTOR_STATUS = Object.freeze({
  ready: Object.freeze({ icon: "✓", label: "Готово к работе" }),
  degraded: Object.freeze({ icon: "⚠", label: "Готово с предупреждениями" }),
  blocked: Object.freeze({ icon: "✗", label: "Есть блокирующие ошибки" }),
});

/** Returns a stable icon and readable label for a machine state. */
export function presentState(state) {
  return STATUS_PRESENTATIONS[state] ?? Object.freeze({ icon: "•", label: state });
}

/** Formats a one-line status heading without ANSI control sequences. */
export function formatStatusHeading(subject, state) {
  const presentation = presentState(state);
  return `${presentation.icon} ${subject} — ${presentation.label}`;
}

/** Makes JSON keys readable while preserving their meaning. */
function readableKey(key) {
  return key
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
}

/** Formats one leaf value for terminal output. */
function scalar(value) {
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value) && value.every((entry) => (
    entry === null || !["object", "function"].includes(typeof entry)
  ))) {
    return value.length > 0 ? value.map((entry) => scalar(entry)).join(", ") : "—";
  }
  return String(value);
}

/** Renders a JSON object as a compact tree instead of exposing serialized JSON. */
function renderTree(value, prefix = "") {
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index + 1), entry])
    : Object.entries(value);
  return entries.flatMap(([key, entry], index) => {
    const last = index === entries.length - 1;
    const connector = last ? "└─" : "├─";
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;
    const nested = entry && typeof entry === "object" && !(
      Array.isArray(entry) && entry.every((item) => (
        item === null || !["object", "function"].includes(typeof item)
      ))
    );
    const label = readableKey(key);
    if (!nested) return [`${prefix}${connector} ${label}: ${scalar(entry)}`];
    const children = renderTree(entry, childPrefix);
    return [`${prefix}${connector} ${label}`, ...children];
  });
}

/** Formats Plugin details, parsing structured JSON only for human presentation. */
export function formatStatusDetails(details) {
  if (typeof details !== "string" || details.trim().length === 0) return Object.freeze([]);
  let parsed;
  try {
    parsed = JSON.parse(details);
  } catch {
    return Object.freeze(details.split(/\r?\n/u));
  }
  if (!parsed || typeof parsed !== "object") return Object.freeze([scalar(parsed)]);
  return Object.freeze(renderTree(parsed));
}

/** Removes a duplicated machine code from the start of a human message. */
function withoutLeadingCode(message, code) {
  if (!code || !message.startsWith(`${code}:`)) return message;
  return message.slice(code.length + 1).trimStart();
}

/** Formats one complete Doctor report for a terminal without changing its JSON contract. */
export function formatDoctorReport(report) {
  const status = DOCTOR_STATUS[report.status] ?? Object.freeze({ icon: "•", label: report.status });
  const summary = Object.entries(DOCTOR_PRESENTATIONS)
    .map(([outcome, { icon, label }]) => [icon, label, report.summary[outcome]]);
  const lines = [
    "OpenSpec Orchestrator Doctor",
    "────────────────────────────",
    "",
    `${status.icon} ${status.label}`,
    "",
    "Результат",
    ...summary.map(([icon, label, count]) => `  ${icon} ${label.padEnd(16)} ${count}`),
    "",
    "Проверки",
  ];
  for (const check of report.checks) {
    const presentation = DOCTOR_PRESENTATIONS[check.outcome] ?? Object.freeze({ icon: "•" });
    lines.push(`  ${presentation.icon} ${check.subject}`);
    if (check.outcome === "pass") continue;
    if (check.code) lines.push(`      Код: ${check.code}`);
    const message = withoutLeadingCode(check.message, check.code);
    for (const details of [message, check.details]) {
      for (const line of formatStatusDetails(details)) lines.push(`      ${line}`);
    }
  }
  lines.push("", "Дальше");
  if (report.status === "ready") {
    lines.push("  Все обязательные проверки пройдены.");
  } else {
    lines.push(report.status === "blocked"
      ? "  Исправьте блокирующие ошибки и повторите:"
      : "  Разберите предупреждения и повторите при необходимости:");
    lines.push("    openspec-orch doctor");
  }
  return Object.freeze(lines);
}
