/** @fileoverview Изменения Repository после последней сохранённой реализации, только по запросу. */

/** Не подменяет отсутствующий checkpoint началом работы или текущим HEAD. */
export async function readTrackingDiff(context, task, checkout) {
  if (!task.implementation_revision) return { available: false, message: "Сохранённой точки реализации ещё нет." };
  try {
    const git = await context.repositories.git(task.repository_id);
    if (!git) throw new Error("Checkout отсутствует");
    const comparison = await git.changesSince(task.implementation_revision);
    if (comparison.to_revision !== checkout?.head || Boolean(comparison.worktree_files.length) !== checkout.dirty) {
      throw new Error("TRACKING_CHECKOUT_CHANGED: состояние checkout изменилось во время чтения; повторите status");
    }
    return { available: true, ...comparison,
      message: "Изменения всего репозитория после последней сохранённой точки; они не обязательно относятся к этой задаче." };
  } catch (error) {
    return { available: false, message: "Сравнение недоступно: повторите status; если ошибка остаётся, проверьте Git и сохранённый commit.",
      details: error.message };
  }
}
