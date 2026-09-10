/** @fileoverview Неизменяемые результаты и отчёты диагностики. */

const OUTCOMES = new Set(["pass", "warning", "error", "skipped"]);

/** Preserves text details or freezes one flat JSON object for machine-readable reports. */
function diagnosticDetails(details) {
  if (typeof details === "string") return details;
  if (
    !details || Array.isArray(details) || Object.getPrototypeOf(details) !== Object.prototype ||
    Object.values(details).some((value) => (
      value !== null && !["boolean", "number", "string"].includes(typeof value)
    ))
  ) {
    throw new Error("DIAGNOSTIC_RESULT_INVALID: details должен быть строкой или flat JSON object");
  }
  return Object.freeze({ ...details });
}

/** Immutable result of one Doctor check. */
export class DiagnosticResult {
  #value;

  constructor({ id, subject, outcome, code = "", message = "", details = "" } = {}) {
    if (
      typeof id !== "string" || id.length === 0 ||
      typeof subject !== "string" || subject.length === 0 ||
      !OUTCOMES.has(outcome) ||
      [code, message].some((value) => typeof value !== "string")
    ) {
      throw new Error("DIAGNOSTIC_RESULT_INVALID: некорректный Doctor check");
    }
    this.#value = Object.freeze({
      id,
      subject,
      outcome,
      code,
      message,
      details: diagnosticDetails(details),
    });
    Object.freeze(this);
  }

  get id() { return this.#value.id; }
  get subject() { return this.#value.subject; }
  get outcome() { return this.#value.outcome; }
  get code() { return this.#value.code; }
  get message() { return this.#value.message; }
  get details() { return this.#value.details; }

  toJSON() { return this.#value; }
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

/** Converts a domain failure to a stable diagnostic result. */
export function failedDiagnostic({ id, subject, fallback }, error) {
  const code = typeof error?.code === "string" && error.code.length > 0
    ? error.code
    : (error instanceof Error ? error.message : String(error)).match(/^([A-Z][A-Z0-9_]+):/u)?.[1] ?? fallback;
  return new DiagnosticResult({
    id,
    subject,
    outcome: "error",
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Appends one independent group while preserving later diagnostics after a failure. */
export async function appendDiagnostics(checks, failure, inspect) {
  try {
    checks.push(...await inspect());
  } catch (error) {
    checks.push(failedDiagnostic(failure, error));
  }
}

/** Creates one skipped check that requires a Store unavailable to Doctor. */
export function skippedDiagnostic(id, subject) {
  return new DiagnosticResult({
    id,
    subject,
    outcome: "skipped",
    code: "STORE_UNAVAILABLE",
    message: "Проверка требует доступный Store",
  });
}
