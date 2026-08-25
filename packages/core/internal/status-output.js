/** @fileoverview Dependency-free human presentation for Core status commands. */

const PRESENTATIONS = Object.freeze({
  blocked: Object.freeze({ icon: "✗", label: "заблокирован" }),
  complete: Object.freeze({ icon: "✓", label: "готов" }),
  completed: Object.freeze({ icon: "✓", label: "завершён" }),
  connected: Object.freeze({ icon: "✓", label: "подключён" }),
  diverged: Object.freeze({ icon: "⚠", label: "параметры не совпадают" }),
  fail: Object.freeze({ icon: "✗", label: "проверка не пройдена" }),
  failed: Object.freeze({ icon: "✗", label: "ошибка" }),
  invalid: Object.freeze({ icon: "✗", label: "некорректное состояние" }),
  missing: Object.freeze({ icon: "✗", label: "checkout отсутствует" }),
  needs_setup_pr: Object.freeze({ icon: "⚠", label: "требуется setup PR" }),
  not_a_directory: Object.freeze({ icon: "✗", label: "путь не является каталогом" }),
  not_a_git_repository: Object.freeze({ icon: "✗", label: "не Git repository" }),
  not_a_git_root: Object.freeze({ icon: "✗", label: "путь не является корнем Git" }),
  pass: Object.freeze({ icon: "✓", label: "проверка пройдена" }),
  ready: Object.freeze({ icon: "✓", label: "готов" }),
  stale: Object.freeze({ icon: "⚠", label: "требует обновления" }),
  unavailable: Object.freeze({ icon: "✗", label: "недоступен" }),
  workspace_unresolved: Object.freeze({ icon: "✗", label: "workspace не определён" }),
});

/** Returns a stable icon and readable label for a machine state. */
export function presentState(state) {
  return PRESENTATIONS[state] ?? Object.freeze({ icon: "•", label: state });
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
