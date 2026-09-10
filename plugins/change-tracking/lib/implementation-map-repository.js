/** @fileoverview Change-local task-to-revision manifest persistence. */

import { setTimeout as delay } from "node:timers/promises";

import { parse, stringify } from "yaml";

import { validateImplementation, implementationKey } from "./implementation-record.js";

import {
  assertChangeId,
  CHANGE_TRACKING_CONTRACT,
  isGitRevision,
} from "./contracts.js";

const MAP_VERSION = CHANGE_TRACKING_CONTRACT.implementationMapVersion;
const UPDATE_RETRY = Object.freeze({ attempts: 20, delayMs: 10 });
const MAP_FIELDS = Object.freeze(["attempts", "change_id", "contract_version", "implementations"]);

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

/** Treats a repeated completion after local cleanup failure as the same durable attempt. */
function sameAttempt(left, right) {
  return [
    "repository_id", "schema_name", "planning_revision", "base_revision",
    "implementation_revision", "started_at",
  ].every((field) => left[field] === right[field]) &&
    left.task.id === right.task.id && left.task.description === right.task.description;
}

/** Owns the one Git-tracked implementation map inside an OpenSpec Change. */
export class ImplementationMapRepository {
  #files;

  constructor(files) {
    if (!files || typeof files.read !== "function" || typeof files.update !== "function") {
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
    return this.#parse(changeId, relativePath, source).attempts;
  }

  #parse(changeId, relativePath, source) {
    if (source === null) return { contract_version: MAP_VERSION, change_id: changeId, attempts: [], implementations: [] };
    let document;
    try {
      document = parse(source);
    } catch (error) {
      corrupted(relativePath, `некорректный YAML: ${error.message}`);
    }
    if (
      !document || typeof document !== "object" || Array.isArray(document) ||
      document.contract_version !== MAP_VERSION ||
      Object.keys(document).sort().join("\0") !== MAP_FIELDS.join("\0") ||
      !Array.isArray(document.implementations) ||
      document.change_id !== changeId || !Array.isArray(document.attempts)
    ) {
      corrupted(relativePath, "ожидается карта реализации текущего Change");
    }
    const attempts = document.attempts.map((attempt) => validateAttempt(attempt, relativePath));
    const implementations = document.implementations.map((entry) => validateImplementation(entry));
    if (new Set(implementations.map(implementationKey)).size !== implementations.length) {
      corrupted(relativePath, "повторяющаяся связь реализации");
    }
    return { ...document, attempts, implementations };
  }

  async readImplementations(changeId) {
    const relativePath = this.pathFor(changeId);
    return this.#parse(changeId, relativePath,
      await this.#files.read(relativePath, { optional: true })).implementations;
  }

  /** Обновляет одну связь PR атомарно, сохраняя остальные задачи и прежние attempts. */
  async record(changeId, entry, expectedVersion, previousTaskId) {
    const relativePath = this.pathFor(changeId);
    const checked = validateImplementation(entry);
    let result;
    await this.#update(relativePath, (source) => {
      const document = this.#parse(changeId, relativePath, source);
      const entries = document.implementations;
      const key = implementationKey(checked);
      const previousKey = implementationKey({ ...checked,
        task: { ...checked.task, id: previousTaskId ?? checked.task.id } });
      const target = entries.find((candidate) => implementationKey(candidate) === key);
      const existing = entries.find((candidate) => implementationKey(candidate) === previousKey);
      // Повтор после потерянного ответа не создаёт новую версию.
      if (target && JSON.stringify(target) === JSON.stringify(checked) &&
          (previousKey === key || !existing)) {
        result = { changed: false, path: relativePath, implementation: target };
        return source;
      }
      if (previousTaskId !== undefined && !existing) {
        throw new Error("IMPLEMENTATION_REBIND_MISSING: исходная связь задачи с этим PR не найдена");
      }
      if (previousKey !== key && target) {
        throw new Error("IMPLEMENTATION_CONFLICT: целевая задача уже связана с этим PR");
      }
      if ((existing?.version ?? 0) !== expectedVersion) {
        throw new Error("IMPLEMENTATION_CONFLICT: связь обновлена другим исполнителем; перечитайте Tracking");
      }
      if (existing && previousTaskId === undefined &&
          (existing.task.description !== checked.task.description || existing.schema_name !== checked.schema_name)) {
        throw new Error("IMPLEMENTATION_TASK_CHANGED: подтвердите соответствие через previous_task_id и актуальную версию связи");
      }
      result = { changed: true, path: relativePath, implementation: checked };
      return stringify({ ...document,
        implementations: [...entries.filter((candidate) => implementationKey(candidate) !== previousKey), checked],
      });
    });
    return result;
  }

  async append(changeId, attempt) {
    const relativePath = this.pathFor(changeId);
    const checked = validateAttempt(attempt, relativePath);
    let result;
    await this.#update(relativePath, (source) => {
      const document = this.#parse(changeId, relativePath, source);
      const attempts = document.attempts;
      const existing = attempts.find((candidate) => sameAttempt(candidate, checked));
      if (existing) {
        result = Object.freeze({ changed: false, path: relativePath, attempt: existing });
        return source;
      }
      result = Object.freeze({ changed: true, path: relativePath, attempt: checked });
      return stringify({
        ...document,
        attempts: [...attempts, checked],
      });
    });
    return result;
  }

  /** Единый повтор атомарной записи при кратковременной блокировке Core. */
  async #update(relativePath, operation) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#files.update(relativePath, operation);
      } catch (error) {
        if (error?.code !== "FILE_UPDATE_BUSY" || attempt >= UPDATE_RETRY.attempts) throw error;
        await delay(UPDATE_RETRY.delayMs);
      }
    }
  }
}
