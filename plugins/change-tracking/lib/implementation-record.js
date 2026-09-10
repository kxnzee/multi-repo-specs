/** @fileoverview Переносимая связь задачи с PR и явными коммитами реализации. */
import { CHANGE_TRACKING_PATTERNS, isGitRevision } from "./contracts.js";

const IMPLEMENTATION_FIELDS = Object.freeze([
  "repository_id", "task", "schema_name", "pull_request", "plan_url",
  "commits", "summary", "remaining", "version",
]);
const TASK_FIELDS = Object.freeze(["id", "description"]);

/** Проверяет точный набор полей без строковой сериализации ключей. */
function hasFields(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

const text = (value) => typeof value === "string" && value.trim().length > 0;
const link = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
};

/** URL PR без fragment; query сохраняется, поскольку может идентифицировать PR. */
function canonicalPullRequest(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

/** Идентичность одной связи задачи с PR в конкретном репозитории. */
export function implementationKey(entry) {
  return JSON.stringify([entry.repository_id, entry.task.id, canonicalPullRequest(entry.pull_request)]);
}

/** Проверяет и нормализует запись одинаково при чтении YAML и записи через CLI/MCP. */
export function validateImplementation(entry) {
  if (!hasFields(entry, IMPLEMENTATION_FIELDS) ||
      typeof entry.repository_id !== "string" || !CHANGE_TRACKING_PATTERNS.identifier.test(entry.repository_id) ||
      !hasFields(entry.task, TASK_FIELDS) ||
      !text(entry.task.id) || !text(entry.task.description) || !text(entry.schema_name) ||
      !link(entry.pull_request) || !link(entry.plan_url) || !text(entry.summary) ||
      typeof entry.remaining !== "string" || !Number.isSafeInteger(entry.version) || entry.version < 1 ||
      !Array.isArray(entry.commits) || !entry.commits.every(isGitRevision) ||
      new Set(entry.commits).size !== entry.commits.length) {
    throw new Error("IMPLEMENTATION_INVALID: нужны задача, Repository, PR/план, полные SHA, итог, оставшаяся работа и версия");
  }
  return {
    repository_id: entry.repository_id,
    task: { id: entry.task.id, description: entry.task.description },
    schema_name: entry.schema_name,
    pull_request: canonicalPullRequest(entry.pull_request),
    plan_url: entry.plan_url,
    commits: [...entry.commits], summary: entry.summary, remaining: entry.remaining, version: entry.version,
  };
}
