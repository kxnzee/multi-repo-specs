/** @fileoverview Чтение текущих OpenSpec, Git и Tracking без изменения хранилищ. */
import { planning } from "./planning.js";
import { fingerprint, localState, nonempty, recordKey, revision } from "./records.js";
import { taskGuidance } from "./presentation.js";
import { readTrackingDiff } from "./diff.js";

/** Сравнивает рабочую копию с записью; ошибка чтения остаётся неизвестным состоянием. */
async function checkoutState(repository, reference) {
  if (repository.error) return "unavailable";
  try {
    if (!await repository.git.hasCommit(reference)) return "missing_commit";
    if (repository.dirty) return "dirty";
    if (repository.head === reference) return "matches";
    return await repository.git.isAncestor(reference, repository.head) ? "ahead" : "diverged";
  } catch { return "unavailable"; }
}

/** Считает задачи один раз, даже если реализация записана в нескольких репозиториях. */
function summarize(plan, tasks) {
  if (!plan) return { total_tasks: null, completed_tasks: null, recorded_tasks: null };
  const recorded = plan.tasks.filter(({ id }) => {
    const rows = tasks.filter(({ task_id }) => task_id === id);
    return rows.length > 0 && rows.every(({ state }) => state === "complete");
  });
  return { total_tasks: plan.tasks.length, completed_tasks: plan.tasks.filter(({ done }) => done).length,
    recorded_tasks: recorded.length };
}

/** Создаёт один свежий отчёт; task_id раскрывает контекст продолжения в том же status. */
export async function readTrackingStatus(context, maps, changeId, { task_id: taskId, diff = false } = {}) {
  if (taskId !== undefined && !nonempty(taskId)) throw new Error("TRACKING_INPUT_INVALID: нужен точный task_id OpenSpec");
  const document = await maps.read(changeId);
  const warnings = [];
  let plan;
  try { plan = await planning(context, changeId); }
  catch (error) { warnings.push({ code: "PLAN_UNAVAILABLE", message: "Не удалось прочитать текущий план OpenSpec.",
    next_step: "Проверьте доступность OpenSpec и Apply-контекста выбранного Change.", details: error.message }); }
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
    const task = plan?.tasks.find((item) => item.id === entry.task_id);
    const fresh = plan?.fingerprint === entry.planning_fingerprint && task !== undefined;
    tasks.push({ task_id: entry.task_id, repository_id: entry.repository_id,
      description: fresh ? task.description : null, state: !plan ? "unknown" : fresh ? entry.state : "stale",
      task_done: fresh ? task.done : null, checkout: await checkoutState(repositories.get(entry.repository_id), entry.implementation_revision),
      implementation_revision: entry.implementation_revision, ...(entry.note ? { note: entry.note } : {}) });
  }
  for (const session of sessions) {
    const task = plan?.tasks.find((item) => item.id === session.task_id);
    const fresh = plan?.fingerprint === session.planning_fingerprint && task !== undefined;
    let row = tasks.find((item) => recordKey(item) === recordKey(session));
    const entry = document.implementations.find((item) => recordKey(item) === recordKey(session));
    if (!row) {
      row = { task_id: session.task_id, repository_id: session.repository_id,
        description: fresh ? task.description : null, state: !plan ? "unknown" : fresh ? "active" : "stale", task_done: fresh ? task.done : null,
        checkout: await checkoutState(repositories.get(session.repository_id), session.base_revision) };
      tasks.push(row);
    }
    // Маркер относится только к выбранной рабочей копии, а не к наличию живого агента.
    const current = entry ? fingerprint(entry) : null;
    const conflict = Boolean(plan && !fresh) || (current !== session.observed && current !== session.last_saved);
    row.local_work = conflict || row.local_work === "conflict" ? "conflict" : "active";
  }
  for (const task of plan?.tasks ?? []) {
    if (!tasks.some((item) => item.task_id === task.id && !["stale", "unknown"].includes(item.state))) {
      tasks.push({ task_id: task.id, repository_id: null, description: task.description, state: "untracked", task_done: task.done });
    }
  }
  tasks.sort((a, b) => {
    const byTask = a.task_id.localeCompare(b.task_id, "en", { numeric: true });
    if (byTask) return byTask;
    // Неопределённая новая связь идёт после прежних записей той же задачи.
    if (a.repository_id === null) return b.repository_id === null ? 0 : 1;
    if (b.repository_id === null) return -1;
    return a.repository_id.localeCompare(b.repository_id, "en");
  });
  const summary = summarize(plan, tasks);
  const selected = taskId === undefined ? tasks : tasks.filter(({ task_id }) => task_id === taskId);
  if (taskId !== undefined && !selected.length && plan) throw new Error("TRACKING_TASK_MISSING: перечитайте ID задачи из OpenSpec Apply");
  for (const task of selected) Object.assign(task, taskGuidance(task, {
    planAvailable: Boolean(plan), storageAvailable,
    currentCheckout: context.invocation?.role === "code" && context.invocation.id === task.repository_id,
  }));
  if (diff) for (const task of selected) task.diff = await readTrackingDiff(context, task, repositories.get(task.repository_id));
  const snapshot = { change_id: changeId, planning_fingerprint: plan?.fingerprint ?? null,
    repositories: [...repositories].map(([repository_id, value]) => ({ repository_id,
      revision: value.head ?? null, clean: value.error ? null : !value.dirty })) };
  return { change_id: changeId, summary, tasks: selected, warnings,
    ...(taskId !== undefined && plan ? { context: { ...plan.sources,
      ...(context.invocation?.role === "code" && selected.some((task) => task.repository_id === context.invocation.id)
        ? { checkout_path: context.invocation.path } : {}) } } : {}),
    candidate: { id: fingerprint(snapshot), ...snapshot } };
}
