/** @fileoverview Narrow OpenSpec task-to-Code-Repository revision tracking flow. */

import {
  assertChangeId,
  CHANGE_TRACKING_CONTRACT,
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
  return { contract_version: CHANGE_TRACKING_CONTRACT.attemptStorageVersion, active_attempts: [] };
}

/** Validates the local Plugin storage envelope owned by this flow. */
function readState(value) {
  if (value === null) return emptyState();
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["active_attempts", "contract_version"].join("\0") ||
    value.contract_version !== CHANGE_TRACKING_CONTRACT.attemptStorageVersion ||
    !Array.isArray(value.active_attempts)
  ) {
    throw new Error("PLUGIN_STORAGE_CORRUPTED: некорректное состояние implementation attempts");
  }
  return value;
}

/** Creates a machine-local identity for one Change, Repository and OpenSpec task. */
function attemptKey(value) {
  return `${value.change_id}\0${value.repository_id}\0${value.task.id}`;
}

/** Resolves an exact task without interpreting schema-specific prose or headings. */
function findTask(instructions, taskId) {
  const task = instructions.tasks.find(({ id }) => id === taskId);
  if (!task) throw new Error(`ATTEMPT_TASK_NOT_FOUND: OpenSpec task '${taskId}' не найден`);
  return task;
}

/** Coordinates local active state and one durable Change-local manifest entry. */
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
    const changedPaths = await repositoryGit.statusPaths();
    if (changedPaths.length > 0) {
      throw new Error(`WORKTREE_DIRTY: ${invocation.id}: ${changedPaths.join(", ")}`);
    }
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
      if (existing) return checked;
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
    const state = readState(await this.#context.storage.read());
    const selector = { change_id: changeId, repository_id: invocation.id, task: { id: taskId } };
    const active = state.active_attempts.find((candidate) => attemptKey(candidate) === attemptKey(selector));
    if (!active) throw new Error("ATTEMPT_NOT_FOUND: сначала запустите attempt для этого task");
    const instructions = await applyInstructions(this.#context.process, changeId);
    const task = findTask(instructions, taskId);
    if (!task.done) {
      throw new Error(`ATTEMPT_TASK_INCOMPLETE: OpenSpec task '${taskId}' ещё не отмечен выполненным`);
    }
    if (task.description !== active.task.description || instructions.schemaName !== active.schema_name) {
      throw new Error("ATTEMPT_TASK_CHANGED: task или схема изменились после начала попытки");
    }
    const repositoryGit = await this.#context.repositories.git(invocation.id);
    if (!repositoryGit) throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${invocation.id}`);
    const changedPaths = await repositoryGit.statusPaths();
    if (changedPaths.length > 0) {
      throw new Error(`WORKTREE_DIRTY: ${invocation.id}: ${changedPaths.join(", ")}`);
    }
    const implementationRevision = await repositoryGit.revision();
    if (!isGitRevision(implementationRevision)) {
      throw new Error("COMMIT_NOT_FOUND: Git вернул некорректную implementation revision");
    }
    const result = await this.#maps.append(changeId, {
      repository_id: active.repository_id,
      task: active.task,
      schema_name: active.schema_name,
      planning_revision: active.planning_revision,
      base_revision: active.base_revision,
      implementation_revision: implementationRevision,
      started_at: active.started_at,
      completed_at: this.#now(),
    });
    await this.#context.storage.update((current) => {
      const checked = readState(current);
      return {
        ...checked,
        active_attempts: checked.active_attempts.filter((candidate) => (
          attemptKey(candidate) !== attemptKey(selector)
        )),
      };
    });
    return Object.freeze({ ...result, stored: "change" });
  }

  async status(changeId) {
    assertChangeId(changeId);
    const state = readState(await this.#context.storage.read());
    const active = state.active_attempts.filter((attempt) => attempt.change_id === changeId);
    return Object.freeze({
      change_id: changeId,
      path: this.#maps.pathFor(changeId),
      active: Object.freeze(active),
      completed: await this.#maps.read(changeId),
    });
  }
}
