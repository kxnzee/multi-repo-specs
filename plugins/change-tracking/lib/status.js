/** @fileoverview Чтение текущих Git и Tracking без изменения хранилищ. */
import { fingerprint, localState, nonempty, recordKey, revision } from "./records.js";
import { taskGuidance } from "./presentation.js";
import { readTrackingDiff } from "./diff.js";

/** Сравнивает рабочую копию с записью; ошибка чтения остаётся неизвестным состоянием. */
async function checkoutState(repository, reference) {
  if (!repository || repository.error) return "unavailable";
  try {
    if (!await repository.git.hasCommit(reference)) return "missing_commit";
    if (repository.dirty) return "dirty";
    if (repository.head === reference) return "matches";
    return await repository.git.isAncestor(reference, repository.head) ? "ahead" : "diverged";
  } catch { return "unavailable"; }
}

/** Считает только собственные записи Plugin, не дублируя прогресс OpenSpec. */
function summarize(tasks) {
  return {
    tracked_records: tasks.length,
    active_records: tasks.filter(({ state }) => state === "active").length,
    partial_records: tasks.filter(({ state }) => state === "partial").length,
    complete_records: tasks.filter(({ state }) => state === "complete").length,
  };
}

/** Создаёт один свежий отчёт; task_id раскрывает контекст продолжения в том же status. */
export async function readTrackingStatus(context, maps, changeId, { task_id: taskId, diff = false } = {}) {
  if (taskId !== undefined && !nonempty(taskId)) throw new Error("TRACKING_INPUT_INVALID: нужен точный task_id");
  const document = await maps.read(changeId);
  const warnings = [];
  let sessions = [];
  let storageAvailable = true;
  try {
    sessions = localState(await context.storage.read()).sessions.filter((item) => item.change_id === changeId && item.active &&
      (context.invocation?.role !== "code" || item.checkout_path === context.invocation.path));
  } catch (error) {
    storageAvailable = false;
    warnings.push({ code: "LOCAL_STATE_UNAVAILABLE", message: "Локальное состояние Tracking недоступно; сохранённая карта прочитана.",
      next_step: "Восстановите проверенную копию локального состояния; сохраните повреждённый файл для диагностики.", details: error.message });
  }
  const repositories = new Map();
  const repositoryIds = [...new Set([...document.implementations, ...sessions].map((item) => item.repository_id))].sort();
  for (const id of repositoryIds) {
    try {
      const git = await context.repositories.git(id);
      if (!git) throw new Error("Checkout отсутствует");
      await git.assertNoOperation();
      const head = await git.revision();
      if (!revision(head)) throw new Error("Git не вернул commit");
      repositories.set(id, { git, head, dirty: (await git.statusPaths([])).length > 0 });
    } catch (error) { repositories.set(id, { error: error.message }); }
  }
  const tasks = [];
  for (const entry of document.implementations) {
    tasks.push({ task_id: entry.task_id, repository_id: entry.repository_id,
      recorded_state: entry.recorded_state,
      state: entry.recorded_state,
      checkout: await checkoutState(repositories.get(entry.repository_id), entry.implementation_revision),
      implementation_revision: entry.implementation_revision, ...(entry.note ? { note: entry.note } : {}) });
  }
  for (const session of sessions) {
    let row = tasks.find((item) => recordKey(item) === recordKey(session));
    const entry = document.implementations.find((item) => recordKey(item) === recordKey(session));
    if (!row) {
      row = { task_id: session.task_id, repository_id: session.repository_id, state: "active",
        checkout: await checkoutState(repositories.get(session.repository_id), session.base_revision) };
      tasks.push(row);
    }
    // Маркер относится только к выбранной рабочей копии, а не к наличию живого агента.
    const current = entry ? fingerprint(entry) : null;
    const conflict = current !== session.observed && current !== session.last_saved;
    row.local_work = conflict || row.local_work === "conflict" ? "conflict" : "active";
  }
  tasks.sort((a, b) => {
    const byTask = a.task_id.localeCompare(b.task_id, "en", { numeric: true });
    if (byTask) return byTask;
    return a.repository_id.localeCompare(b.repository_id, "en");
  });
  const summary = summarize(tasks);
  const selected = taskId === undefined ? tasks : tasks.filter(({ task_id }) => task_id === taskId);
  if (taskId !== undefined && !selected.length) {
    throw new Error("TRACKING_RECORD_MISSING: для task_id нет локальной или сохранённой записи");
  }
  for (const task of selected) Object.assign(task, taskGuidance(task, { storageAvailable }));
  if (diff) for (const task of selected) task.diff = await readTrackingDiff(context, task, repositories.get(task.repository_id));
  return { change_id: changeId, summary, tasks: selected, warnings };
}
