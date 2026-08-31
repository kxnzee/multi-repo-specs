/** @fileoverview Change-local task-to-revision manifest persistence. */

import { parse, stringify } from "yaml";

import {
  assertChangeId,
  CHANGE_TRACKING_CONTRACT,
  isGitRevision,
} from "./contracts.js";

/** Reports a malformed Change-local implementation map. */
function corrupted(path, message) {
  throw new Error(`STATE_CORRUPTED: ${path}: ${message}`);
}

/** Accepts one serialized instant without changing its original representation. */
function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Validates one strict task-to-revision entry. */
function validateAttempt(candidate, path) {
  if (
    !candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
    Object.keys(candidate).some((key) => ![
      "repository_id", "task", "schema_name", "planning_revision", "base_revision",
      "implementation_revision", "started_at", "completed_at",
    ].includes(key)) ||
    typeof candidate.repository_id !== "string" || candidate.repository_id.length === 0 ||
    !candidate.task || typeof candidate.task !== "object" || Array.isArray(candidate.task) ||
    Object.keys(candidate.task).sort().join("\0") !== ["description", "id"].join("\0") ||
    typeof candidate.task.id !== "string" || candidate.task.id.length === 0 ||
    typeof candidate.task.description !== "string" || candidate.task.description.length === 0 ||
    typeof candidate.schema_name !== "string" || candidate.schema_name.length === 0 ||
    !isGitRevision(candidate.planning_revision) ||
    !isGitRevision(candidate.base_revision) ||
    !isGitRevision(candidate.implementation_revision) ||
    !validDate(candidate.started_at) || !validDate(candidate.completed_at)
  ) {
    corrupted(path, "некорректная implementation attempt");
  }
  return Object.freeze({
    ...candidate,
    task: Object.freeze({ ...candidate.task }),
  });
}

/** Selects one durable entry per Repository and task in the narrow first version. */
function key(attempt) {
  return `${attempt.repository_id}\0${attempt.task.id}`;
}

/** Treats a repeated completion after local cleanup failure as the same durable attempt. */
function sameAttempt(left, right) {
  const withoutCompletionTime = (value) => {
    const attempt = { ...value };
    delete attempt.completed_at;
    return attempt;
  };
  return JSON.stringify(withoutCompletionTime(left)) === JSON.stringify(withoutCompletionTime(right));
}

/** Owns the one Git-tracked implementation map inside an OpenSpec Change. */
export class ImplementationMapRepository {
  #files;

  constructor(files) {
    if (!files || typeof files.read !== "function" || typeof files.write !== "function") {
      throw new Error("CHANGE_TRACKING_INVALID: требуется Files facade");
    }
    this.#files = files;
    Object.freeze(this);
  }

  pathFor(changeId) {
    assertChangeId(changeId);
    return `openspec/changes/${changeId}/${CHANGE_TRACKING_CONTRACT.implementationMapFile}`;
  }

  async read(changeId) {
    const relativePath = this.pathFor(changeId);
    const source = await this.#files.read(relativePath, { optional: true });
    if (source === null) return Object.freeze([]);
    let document;
    try {
      document = parse(source);
    } catch (error) {
      corrupted(relativePath, `некорректный YAML: ${error.message}`);
    }
    if (
      !document || typeof document !== "object" || Array.isArray(document) ||
      Object.keys(document).sort().join("\0") !== ["attempts", "change_id", "contract_version"].join("\0") ||
      document.contract_version !== CHANGE_TRACKING_CONTRACT.implementationMapVersion ||
      document.change_id !== changeId || !Array.isArray(document.attempts)
    ) {
      corrupted(relativePath, "ожидается implementation map v1 текущего Change");
    }
    const attempts = document.attempts.map((attempt) => validateAttempt(attempt, relativePath));
    if (new Set(attempts.map(key)).size !== attempts.length) {
      corrupted(relativePath, "повторяется task для одного Repository");
    }
    return Object.freeze(attempts);
  }

  async append(changeId, attempt) {
    const relativePath = this.pathFor(changeId);
    const checked = validateAttempt(attempt, relativePath);
    const attempts = await this.read(changeId);
    const existing = attempts.find((candidate) => key(candidate) === key(checked));
    if (existing) {
      if (!sameAttempt(existing, checked)) {
        throw new Error(
          "ATTEMPT_ALREADY_COMPLETED: повторная попытка для этого task пока не поддерживается",
        );
      }
      return Object.freeze({ changed: false, path: relativePath, attempt: existing });
    }
    await this.#files.write(relativePath, stringify({
      contract_version: CHANGE_TRACKING_CONTRACT.implementationMapVersion,
      change_id: changeId,
      attempts: [...attempts, checked],
    }));
    return Object.freeze({ changed: true, path: relativePath, attempt: checked });
  }
}
