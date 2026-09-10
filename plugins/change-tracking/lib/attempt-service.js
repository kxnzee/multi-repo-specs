/** @fileoverview Narrow OpenSpec task-to-Code-Repository revision tracking flow. */

import {
  assertChangeId,
  CHANGE_TRACKING_CONTRACT,
  CHANGE_TRACKING_PATTERNS,
  isGitRevision,
} from "./contracts.js";
import { ImplementationMapRepository } from "./implementation-map-repository.js";
import { applyInstructions, requireOpenSpec11 } from "./openspec-compatibility.js";

/** Validates the opaque task identity returned by OpenSpec. */
function requireTaskId(taskId) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("ATTEMPT_TASK_INVALID: task_id должен быть непустой строкой");
  }
}

/** Requires a Code Repository while retaining the Store-scoped Plugin context. */
function requireCodeInvocation(context) {
  const invocation = context.invocation;
  if (!invocation || invocation.role !== "code") {
    throw new Error("ATTEMPT_CONTEXT_INVALID: вызовите команду из Code Repository");
  }
  return invocation;
}

/** Creates the first machine-local state document. */
function emptyState() {
  return { contract_version: CHANGE_TRACKING_CONTRACT.attemptStorageVersion, active_attempts: [], cancelled_attempts: [] };
}

/** Validates the local Plugin storage envelope owned by this flow. */
function readState(value) {
  if (value === null) return emptyState();
  if (value?.contract_version === 1 && Object.keys(value).sort().join("\0") === "active_attempts\0contract_version") {
    value = { ...value, contract_version: CHANGE_TRACKING_CONTRACT.attemptStorageVersion, cancelled_attempts: [] };
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["active_attempts", "cancelled_attempts", "contract_version"].join("\0") ||
    value.contract_version !== CHANGE_TRACKING_CONTRACT.attemptStorageVersion ||
    !Array.isArray(value.active_attempts) || !Array.isArray(value.cancelled_attempts)
  ) {
    throw new Error("PLUGIN_STORAGE_CORRUPTED: некорректное состояние implementation attempts");
  }
  for (const record of value.cancelled_attempts) {
    if (!record || Object.keys(record).sort().join("\0") !== "attempt\0cancelled_at\0reason" ||
      typeof record.reason !== "string" || !record.reason.trim() ||
      typeof record.cancelled_at !== "string" || Number.isNaN(Date.parse(record.cancelled_at))) {
      throw new Error("PLUGIN_STORAGE_CORRUPTED: некорректная отменённая attempt");
    }
    readState({ ...emptyState(), active_attempts: [record.attempt] });
  }
  const keys = new Set();
  for (const attempt of value.active_attempts) {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt) ||
      Object.keys(attempt).sort().join("\0") !== [
        "base_revision", "change_id", "planning_revision", "repository_id", "schema_name", "started_at", "task",
      ].join("\0") ||
      typeof attempt.change_id !== "string" ||
      !CHANGE_TRACKING_PATTERNS.identifier.test(attempt.change_id) ||
      typeof attempt.repository_id !== "string" ||
      !CHANGE_TRACKING_PATTERNS.identifier.test(attempt.repository_id) ||
      !attempt.task || typeof attempt.task !== "object" || Array.isArray(attempt.task) ||
      Object.keys(attempt.task).sort().join("\0") !== "description\0id" ||
      typeof attempt.task.id !== "string" || !attempt.task.id ||
      typeof attempt.task.description !== "string" || !attempt.task.description ||
      typeof attempt.schema_name !== "string" || !attempt.schema_name ||
      !isGitRevision(attempt.planning_revision) || !isGitRevision(attempt.base_revision) ||
      typeof attempt.started_at !== "string" || Number.isNaN(Date.parse(attempt.started_at))) {
      throw new Error("PLUGIN_STORAGE_CORRUPTED: некорректная активная implementation attempt");
    }
    const key = attemptKey(attempt);
    if (keys.has(key)) throw new Error("PLUGIN_STORAGE_CORRUPTED: повторяющаяся активная attempt");
    keys.add(key);
  }
  return value;
}

/** Creates a machine-local identity for one Change, Repository and OpenSpec task. */
function attemptKey(value) {
  return `${value.change_id}\0${value.repository_id}\0${value.task.id}`;
}

/** Matches durable evidence to the original local attempt, independently of current Git state. */
function matchesCompletedAttempt(record, attempt) {
  return record.task.id === attempt.task.id && record.task.description === attempt.task.description &&
    ["repository_id", "schema_name", "planning_revision", "base_revision", "started_at"]
      .every((field) => record[field] === attempt[field]);
}

/** Resolves an exact task without interpreting schema-specific prose or headings. */
function findTask(instructions, taskId) {
  const task = instructions.tasks.find(({ id }) => id === taskId);
  if (!task) throw new Error(
    `ATTEMPT_TASK_NOT_FOUND: OpenSpec task '${taskId}' не найден. ` +
    "Используйте точный tasks[].id из актуальных OpenSpec Apply instructions; " +
    "номер вроде 1.1 в description не заменяет ID. " +
    "Не вычисляйте индекс и не подбирайте другую задачу.",
  );
  return task;
}

/** Requires a committed snapshot only for revision-tracking operations. */
async function requireClean(git, paths, code, message) {
  const changed = await git.statusPaths(paths);
  if (changed.length > 0) throw new Error(`${code}: ${message}: ${changed.join(", ")}`);
}

/** Coordinates local active state and durable Change-local attempt history. */
export class AttemptTrackingService {
  #context;
  #maps;
  #now;

  constructor(context, { now = () => new Date().toISOString() } = {}) {
    if (
      !context || context.repository?.role !== "store" ||
      typeof context.repositories?.git !== "function" ||
      typeof context.git?.latestRevision !== "function" ||
      typeof context.process?.run !== "function" ||
      typeof context.storage?.read !== "function" ||
      typeof context.storage?.update !== "function"
    ) {
      throw new Error("CHANGE_TRACKING_CONTEXT_INVALID: требуется Store PluginContext");
    }
    this.#context = context;
    this.#maps = new ImplementationMapRepository(context.files);
    this.#now = now;
    Object.freeze(this);
  }

  async start({ changeId, taskId }) {
    assertChangeId(changeId);
    requireTaskId(taskId);
    const invocation = requireCodeInvocation(this.#context);
    await requireOpenSpec11(this.#context.process);
    const instructions = await applyInstructions(this.#context.process, changeId);
    const task = findTask(instructions, taskId);
    if (task.done) throw new Error(`ATTEMPT_TASK_COMPLETE: OpenSpec task '${taskId}' уже завершён`);
    const repositoryGit = await this.#context.repositories.git(invocation.id);
    if (!repositoryGit) throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${invocation.id}`);
    await requireClean(repositoryGit, [], "WORKTREE_DIRTY", invocation.id);
    await requireClean(this.#context.git, [`openspec/changes/${changeId}`],
      "PLANNING_WORKTREE_DIRTY", "сохраните изменения текущего Change в Git перед началом attempt");
    const [baseRevision, planningRevision] = await Promise.all([
      repositoryGit.revision(),
      this.#context.git.latestRevision([`openspec/changes/${changeId}`]),
    ]);
    if (!isGitRevision(baseRevision) || !isGitRevision(planningRevision)) {
      throw new Error("COMMIT_NOT_FOUND: Git вернул некорректную ревизию");
    }
    const attempt = Object.freeze({
      change_id: changeId,
      repository_id: invocation.id,
      task: Object.freeze({ id: task.id, description: task.description }),
      schema_name: instructions.schemaName,
      planning_revision: planningRevision,
      base_revision: baseRevision,
      started_at: this.#now(),
    });
    let changed = false;
    const state = await this.#context.storage.update((current) => {
      const checked = readState(current);
      const existing = checked.active_attempts.find((candidate) => (
        attemptKey(candidate) === attemptKey(attempt)
      ));
      if (existing) {
        if (existing.task.description !== task.description || existing.schema_name !== instructions.schemaName) {
          throw new Error("ATTEMPT_TASK_CHANGED: task или схема изменились; отмените прежнюю attempt через CLI attempt cancel с причиной перед новым start");
        }
        return checked;
      }
      changed = true;
      return { ...checked, active_attempts: [...checked.active_attempts, attempt] };
    });
    const stored = state.active_attempts.find((candidate) => attemptKey(candidate) === attemptKey(attempt));
    return Object.freeze({ ...stored, changed, stored: "local" });
  }

  async complete({ changeId, taskId }) {
    assertChangeId(changeId);
    requireTaskId(taskId);
    const invocation = requireCodeInvocation(this.#context);
    await requireOpenSpec11(this.#context.process);
    let result;
    await this.#context.storage.update(async (current) => {
      const state = readState(current);
      const selector = { change_id: changeId, repository_id: invocation.id, task: { id: taskId } };
      const active = state.active_attempts.find((candidate) => attemptKey(candidate) === attemptKey(selector));
      if (!active) throw new Error(
        "ATTEMPT_NOT_FOUND: активная attempt для этого task_id не найдена. " +
        "Сверьте ID и описание задачи с активной attempt текущего Change " +
        "и Repository; номер задачи из description не заменяет ID. " +
        "Если attempt не начиналась до реализации, не создавайте её задним числом.",
      );
      const completed = (await this.#maps.read(changeId))
        .find((record) => matchesCompletedAttempt(record, active));
      if (completed) {
        result = { changed: false, path: this.#maps.pathFor(changeId), attempt: completed };
        return { ...state, active_attempts: state.active_attempts.filter((candidate) => candidate !== active) };
      }
      const instructions = await applyInstructions(this.#context.process, changeId);
      const task = findTask(instructions, taskId);
      if (!task.done) {
        throw new Error(`ATTEMPT_TASK_INCOMPLETE: OpenSpec task '${taskId}' ещё не отмечен выполненным`);
      }
      if (task.description !== active.task.description || instructions.schemaName !== active.schema_name) {
        throw new Error("ATTEMPT_TASK_CHANGED: task или схема изменились; отмените прежнюю attempt через CLI attempt cancel с причиной перед новым start");
      }
      const repositoryGit = await this.#context.repositories.git(invocation.id);
      if (!repositoryGit) throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${invocation.id}`);
      await requireClean(repositoryGit, [], "WORKTREE_DIRTY", invocation.id);
      const implementationRevision = await repositoryGit.revision();
      if (!isGitRevision(implementationRevision)) {
        throw new Error("COMMIT_NOT_FOUND: Git вернул некорректную implementation revision");
      }
      if (implementationRevision === active.base_revision) {
        throw new Error("ATTEMPT_IMPLEMENTATION_MISSING: после начала attempt нет нового commit");
      }
      if (!await repositoryGit.isAncestor(active.base_revision, implementationRevision)) {
        throw new Error("ATTEMPT_HISTORY_CHANGED: текущий commit не продолжает base_revision активной attempt; проверьте ветку и историю Git");
      }
      result = await this.#maps.append(changeId, {
        repository_id: active.repository_id,
        task: active.task,
        schema_name: active.schema_name,
        planning_revision: active.planning_revision,
        base_revision: active.base_revision,
        implementation_revision: implementationRevision,
        started_at: active.started_at,
        completed_at: this.#now(),
      });
      return {
        ...state,
        active_attempts: state.active_attempts.filter((candidate) => attemptKey(candidate) !== attemptKey(selector)),
      };
    });
    return Object.freeze({ ...result, stored: "change" });
  }

  /** Cancels one local attempt atomically; never records it as completed implementation. */
  async cancel({ changeId, taskId, reason }) {
    assertChangeId(changeId);
    requireTaskId(taskId);
    const invocation = requireCodeInvocation(this.#context);
    if (typeof reason !== "string" || !reason.trim()) throw new Error("ATTEMPT_REASON_REQUIRED: укажите причину отмены");
    const selector = { change_id: changeId, repository_id: invocation.id, task: { id: taskId } };
    let cancelled;
    await this.#context.storage.update(async (current) => {
      const state = readState(current);
      const attempt = state.active_attempts.find((candidate) => attemptKey(candidate) === attemptKey(selector));
      if (!attempt) throw new Error("ATTEMPT_NOT_FOUND: активная attempt для отмены не найдена");
      const completed = await this.#maps.read(changeId);
      if (completed.some((record) => matchesCompletedAttempt(record, attempt))) {
        throw new Error("ATTEMPT_ALREADY_COMPLETED: implementation map уже содержит результат; повторите complete для завершения локальной записи");
      }
      cancelled = { attempt, reason: reason.trim(), cancelled_at: this.#now() };
      return { ...state,
        active_attempts: state.active_attempts.filter((candidate) => attemptKey(candidate) !== attemptKey(selector)),
        cancelled_attempts: [...state.cancelled_attempts, cancelled],
      };
    });
    return Object.freeze({ ...cancelled, stored: "local" });
  }

  async status(changeId) {
    assertChangeId(changeId);
    const state = readState(await this.#context.storage.read());
    const active = state.active_attempts.filter((attempt) => attempt.change_id === changeId);
    return Object.freeze({
      change_id: changeId,
      path: this.#maps.pathFor(changeId),
      active: Object.freeze(active),
      cancelled: Object.freeze(state.cancelled_attempts.filter(({ attempt }) => attempt.change_id === changeId)),
      completed: await this.#maps.read(changeId),
    });
  }
}
