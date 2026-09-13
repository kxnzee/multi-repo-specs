/** @fileoverview Один процесс локальной работы и переносимых checkpoint. */
import { ImplementationMap } from "./map.js";
import { planning } from "./planning.js";
import { fingerprint, identifier, localState, nonempty, recordKey, revision } from "./records.js";
import { readTrackingStatus } from "./status.js";
import { operationMessage } from "./presentation.js";
import { readTrackingOverview } from "./overview.js";

/** Вызов записи принадлежит конкретному Code checkout, включая worktree. */
function invocation(context, changeId, taskId) {
  if (!identifier(changeId) || !nonempty(taskId)) throw new Error("TRACKING_INPUT_INVALID: нужны change_id и точный task_id OpenSpec");
  const repo = context.invocation;
  if (repo?.role !== "code" || !repo.path) throw new Error("TRACKING_CONTEXT_INVALID: вызовите из Code Repository");
  return repo;
}

/** Выбирает задачу по текущему каноническому ID. */
function taskFor(plan, id) {
  const task = plan.tasks.find((item) => item.id === id);
  if (!task) throw new Error("TRACKING_TASK_MISSING: перечитайте ID задачи из OpenSpec Apply");
  return task;
}

/** Начало и публикация checkpoint используют зафиксированный checkout. */
async function cleanHead(git) {
  if (!git) throw new Error("TRACKING_CHECKOUT_UNAVAILABLE: рабочая копия отсутствует");
  await git.assertNoOperation();
  if ((await git.statusPaths([])).length) throw new Error("TRACKING_WORKTREE_DIRTY: сохраните изменения Code Repository в Git");
  const head = await git.revision();
  if (!revision(head)) throw new Error("TRACKING_REVISION_INVALID: Git не вернул commit");
  return head;
}

export class ChangeTrackingApplication {
  constructor(context) {
    this.context = context;
    this.maps = new ImplementationMap(context.files);
  }

  async start({ change_id: changeId, task_id: taskId, restart = false }) {
    if (typeof restart !== "boolean") throw new Error("TRACKING_INPUT_INVALID: restart должен быть boolean");
    const repo = invocation(this.context, changeId, taskId);
    const plan = await planning(this.context, changeId, { committed: true });
    const task = taskFor(plan, taskId);
    if (task.done) throw new Error("TRACKING_TASK_COMPLETE: для новой работы сначала откройте задачу в OpenSpec");
    const git = await this.context.repositories.git(repo.id);
    const head = await cleanHead(git);
    const storeHead = await this.context.git.revision();
    if (!revision(storeHead)) throw new Error("TRACKING_REVISION_INVALID: Store не содержит commit");
    const current = (await this.maps.read(changeId)).implementations.find((item) => recordKey(item) === recordKey({ repository_id: repo.id, task_id: taskId }));
    const selector = (item) => item.change_id === changeId && item.repository_id === repo.id &&
      item.task_id === taskId && item.checkout_path === repo.path;
    let changed = false;
    let session;
    await this.context.storage.update(async (value) => {
      const state = localState(value);
      const active = state.sessions.find((item) => selector(item) && item.active);
      if (active && !restart) {
        if (active.planning_fingerprint !== plan.fingerprint) throw new Error("TRACKING_PLAN_CHANGED: проверьте новое задание и используйте start --restart");
        session = active;
        return state;
      }
      if (current && !restart) {
        if (current.planning_fingerprint !== plan.fingerprint) throw new Error("TRACKING_PLAN_CHANGED: проверьте новое задание; start --restart явно начинает работу по новому плану");
        if (!await git.hasCommit(current.implementation_revision)) throw new Error("TRACKING_COMMIT_MISSING: получите сохранённый commit обычным Git-процессом");
        if (head !== current.implementation_revision) throw new Error("TRACKING_CHECKOUT_MISMATCH: продолжение требует checkout сохранённой revision; start --restart начинает новую работу явно");
      }
      session = { change_id: changeId, repository_id: repo.id, task_id: taskId, checkout_path: repo.path,
        planning_revision: current && !restart ? current.planning_revision : storeHead,
        planning_fingerprint: plan.fingerprint,
        base_revision: current?.state === "partial" && !restart ? current.base_revision : head,
        observed: current ? fingerprint(current) : null, last_saved: null, active: true };
      changed = true;
      return { ...state, sessions: [...state.sessions.filter((item) => !selector(item)), session] };
    });
    return { changed, state: "active", repository_id: repo.id, task_id: taskId, base_revision: session.base_revision,
      ...operationMessage("start", changed, task, repo.id) };
  }

  checkpoint(input) { return this.save(input, "partial"); }
  complete(input) { return this.save(input, "complete"); }

  async save({ change_id: changeId, task_id: taskId, note }, targetState) {
    const repo = invocation(this.context, changeId, taskId);
    if (note !== undefined && !nonempty(note)) throw new Error("TRACKING_INPUT_INVALID: note должна быть непустой строкой");
    let result;
    let savedTask;
    await this.context.storage.update(async (value) => {
      const state = localState(value);
      const session = state.sessions.find((item) => item.change_id === changeId && item.repository_id === repo.id &&
        item.task_id === taskId && item.checkout_path === repo.path);
      if (!session) throw new Error("TRACKING_NOT_STARTED: сначала вызовите start из этой рабочей копии");
      const current = (await this.maps.read(changeId)).implementations.find((item) => recordKey(item) === recordKey(session));
      const plan = await planning(this.context, changeId);
      const task = taskFor(plan, taskId);
      savedTask = task;
      if (plan.fingerprint !== session.planning_fingerprint) throw new Error("TRACKING_PLAN_CHANGED: задание изменилось после start; проверьте изменения перед start --restart");
      if (targetState === "complete" && !task.done) throw new Error("TRACKING_TASK_OPEN: complete требует выполненную галочку OpenSpec");
      const git = await this.context.repositories.git(repo.id);
      const head = await cleanHead(git);
      if (!await git.hasCommit(session.base_revision) || !await git.isAncestor(session.base_revision, head)) {
        throw new Error("TRACKING_HISTORY_CHANGED: текущая revision не продолжает начало работы");
      }
      if (!session.active) {
        if (targetState === "complete" && current?.state === "complete" && current.implementation_revision === head &&
          fingerprint(current) === session.last_saved) {
          result = { changed: false, path: this.maps.path(changeId), implementation: current };
          return state;
        }
        throw new Error("TRACKING_NOT_STARTED: для новой работы вызовите start");
      }
      const entry = { repository_id: repo.id, task_id: taskId, planning_revision: session.planning_revision,
        planning_fingerprint: session.planning_fingerprint, base_revision: session.base_revision,
        implementation_revision: head, state: targetState,
        ...(targetState === "partial" && note ? { note: note.trim() } : {}) };
      result = await this.maps.save(changeId, entry, session.observed);
      const updated = { ...session, observed: fingerprint(result.implementation), last_saved: fingerprint(result.implementation),
        active: targetState === "partial" };
      return { ...state, sessions: state.sessions.map((item) => item === session ? updated : item) };
    });
    return { ...result, ...operationMessage(targetState === "partial" ? "checkpoint" : "complete", result.changed, savedTask, repo.id, note) };
  }

  async cancel({ change_id: changeId, task_id: taskId, reason }) {
    const repo = invocation(this.context, changeId, taskId);
    if (!nonempty(reason)) throw new Error("TRACKING_INPUT_INVALID: укажите причину отмены");
    let changed = false;
    await this.context.storage.update((value) => {
      const state = localState(value);
      const sessions = state.sessions.filter((item) => {
        const match = item.change_id === changeId && item.repository_id === repo.id && item.task_id === taskId && item.checkout_path === repo.path;
        if (match) changed = true;
        return !match;
      });
      return { ...state, sessions };
    });
    return { changed, repository_id: repo.id, task_id: taskId, reason: reason.trim(),
      ...operationMessage("cancel", changed, { id: taskId }, repo.id, reason.trim()) };
  }

  async getStatus(changeId, { all = false, task_id: taskId, diff = false } = {}) {
    if (typeof all !== "boolean" || typeof diff !== "boolean" ||
      (all ? changeId !== undefined || taskId !== undefined || diff : !identifier(changeId)) ||
      (diff && !nonempty(taskId))) {
      throw new Error("TRACKING_INPUT_INVALID: укажите Change или --all; --diff требует Change и точный --task");
    }
    if (all) return readTrackingOverview(this.context, (id) => this.getStatus(id));
    return readTrackingStatus(this.context, this.maps, changeId, { task_id: taskId, diff });
  }
}
