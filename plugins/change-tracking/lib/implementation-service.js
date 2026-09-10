/** @fileoverview Передача частичной реализации через Change без локальных attempts. */
import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { assertChangeId } from "./contracts.js";
import { ImplementationMapRepository } from "./implementation-map-repository.js";
import { validateImplementation } from "./implementation-record.js";
import { applyInstructions, requireOpenSpec11 } from "./openspec-compatibility.js";

const RECORD_FIELDS = new Set([
  "change_id", "task_id", "task_description", "pull_request", "plan_url",
  "commits", "summary", "remaining", "expected_version", "previous_task_id",
]);

/** Совпадение сохранённой задачи с актуальной задачей выбранной схемы. */
function matchesTask(entry, task, schemaName) {
  return task !== undefined && entry.task.id === task.id &&
    entry.task.description === task.description && entry.schema_name === schemaName;
}

export class ImplementationTrackingService {
  #context;
  #maps;

  constructor(context) {
    this.#context = context;
    this.#maps = new ImplementationMapRepository(context.files);
  }

  async record(input) {
    const { change_id: changeId, task_id: taskId, task_description: description,
      pull_request: pullRequest, plan_url: planUrl, commits, summary, remaining,
      expected_version: expectedVersion, previous_task_id: previousTaskId } = input;
    if (Object.keys(input).some((key) => !RECORD_FIELDS.has(key)) ||
        !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
        (previousTaskId !== undefined && (typeof previousTaskId !== "string" || !previousTaskId.trim()))) {
      throw new Error("IMPLEMENTATION_INVALID: передайте expected_version из Tracking (0 для новой связи)");
    }
    assertChangeId(changeId);
    const invocation = this.#context.invocation;
    if (invocation?.role !== REPOSITORY_ROLE.code) throw new Error("IMPLEMENTATION_CONTEXT_INVALID: вызовите из Code Repository");
    await requireOpenSpec11(this.#context.process);
    const instructions = await applyInstructions(this.#context.process, changeId);
    const task = instructions.tasks.find(({ id }) => id === taskId);
    if (!task || task.description !== description) {
      throw new Error("IMPLEMENTATION_TASK_CHANGED: перечитайте точные ID и описание задачи из OpenSpec Apply");
    }
    const entry = validateImplementation({ repository_id: invocation.id,
      task: { id: task.id, description: task.description }, schema_name: instructions.schemaName,
      pull_request: pullRequest, plan_url: planUrl ?? pullRequest,
      commits, summary, remaining, version: expectedVersion + 1 });
    const git = await this.#context.repositories.git(invocation.id);
    if (!git) throw new Error(`REPOSITORY_CHECKOUT_UNAVAILABLE: ${invocation.id}`);
    for (const revision of entry.commits) {
      if (!await git.hasCommit(revision)) throw new Error(`IMPLEMENTATION_COMMIT_MISSING: ${revision}`);
    }
    const result = await this.#maps.record(changeId, entry, expectedVersion, previousTaskId);
    return { ...result, task_done: task.done, stored: "change" };
  }

  async status(changeId) {
    const entries = await this.#maps.readImplementations(changeId);
    if (!entries.length) return [];
    return (await this.#overview(changeId, entries, [])).implementations;
  }

  /** Объединяет актуальные задачи со связями, не создавая второй источник checkbox. */
  async overview(changeId, completed = []) {
    assertChangeId(changeId);
    return this.#overview(changeId, await this.#maps.readImplementations(changeId), completed);
  }

  async #overview(changeId, entries, completed) {
    const instructions = await applyInstructions(this.#context.process, changeId);
    const tasksById = new Map(instructions.tasks.map((task) => [task.id, task]));
    const implementations = entries.map((entry) => {
      const task = tasksById.get(entry.task.id);
      const matches = matchesTask(entry, task, instructions.schemaName);
      const warnings = [];
      if (!matches) warnings.push("TASK_CHANGED_OR_MISSING");
      if (matches && task.done && entry.remaining.trim()) warnings.push("DONE_WITH_REMAINING_WORK");
      return { ...entry, task_done: matches ? task.done : null,
        task_state: matches ? (task.done ? "done" : "open") : "changed_or_missing", warnings };
    });
    const tasks = instructions.tasks.map((task) => {
      const linked = implementations.filter((entry) => entry.task.id === task.id && entry.task_done !== null);
      const old = completed.filter((entry) => matchesTask(entry, task, instructions.schemaName));
      const warnings = [...new Set(linked.flatMap((entry) => entry.warnings))];
      if (task.done && !linked.length && !old.length) warnings.push("DONE_WITHOUT_IMPLEMENTATION");
      else if (task.done && !old.length && linked.every((entry) => !entry.commits.length)) {
        warnings.push("DONE_WITHOUT_COMMITS");
      }
      return { ...task, implementations: linked.map(({ repository_id, pull_request, version }) => ({ repository_id, pull_request, version })),
        legacy_implementations: old.length, warnings };
    });
    return { implementations, tasks };
  }
}
