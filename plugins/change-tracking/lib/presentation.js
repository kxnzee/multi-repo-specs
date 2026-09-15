/** @fileoverview Общее представление фактов Tracking для человека и агента. */

/** Сообщает ближайший шаг по наблюдаемому состоянию, не назначая работу. */
export function taskGuidance(task, { storageAvailable }) {
  const reply = (message, next_step, needs_attention = false) => ({ message, next_step, needs_attention });
  if (task.local_work === "conflict") return reply("Локальная запись начала работы устарела.",
    "Сопоставьте свою рабочую копию с сохранённым результатом перед продолжением.", true);
  if (["unavailable", "missing_commit", "diverged"].includes(task.checkout)) {
    const reasons = { unavailable: "Рабочую копию не удалось проверить.",
      missing_commit: "Сохранённый commit отсутствует в рабочей копии.",
      diverged: "Текущая история не содержит сохранённую реализацию." };
    return reply(reasons[task.checkout], "Подготовьте нужный Code checkout обычным Git-процессом и повторите status.", true);
  }
  if (task.checkout === "dirty") return reply("В рабочей копии есть незакоммиченные изменения.",
    "Проверьте и сохраните изменения в Git перед checkpoint или complete.", true);
  if (!storageAvailable) return reply("Локальное состояние работы неизвестно.",
    "Восстановите локальное состояние Tracking перед записью нового результата.", true);
  if (task.state === "complete") return reply(
    task.checkout === "ahead" ? "Итог записан; рабочая копия содержит более поздние коммиты." : "Итог реализации записан.",
    null);
  if (task.state === "partial") {
    if (task.local_work === "active") return reply("Промежуточный результат сохранён; есть локальное начало работы.",
      "Продолжите задачу. Следующий результат сохраните через checkpoint или complete.");
    return reply("Промежуточный результат сохранён.", task.checkout === "matches"
      ? "Для продолжения вызовите start из этого Code checkout."
      : "Подготовьте точный сохранённый commit перед продолжением через start.");
  }
  if (task.state === "active") return reply("Начало работы записано; сохранённого результата пока нет.",
    "Продолжите задачу и сохраните committed результат через checkpoint или complete.");
  return reply("Записи реализации пока нет.", "Проверьте выбранный Code Repository и вызовите start.");
}

/** Обычные ответы не раскрывают внутренние revisions и не дублируют evidence. */
export function compactStatus(report) {
  if (report.changes) return report;
  const compact = { ...report };
  return { ...compact, warnings: report.warnings.map((warning) => {
    const item = { ...warning };
    delete item.details;
    return item;
  }), tasks: report.tasks.map((task) => {
    const row = { ...task };
    delete row.implementation_revision;
    delete row.recorded_state;
    if (row.diff) {
      row.diff = { ...row.diff };
      delete row.diff.from_revision;
      delete row.diff.to_revision;
      delete row.diff.details;
    }
    return row;
  }) };
}

/** Форматирует уже собранный отчёт без повторных запросов к Git или OpenSpec. */
export function formatStatus(report) {
  const { tracked_records: tracked, active_records: active, partial_records: partial,
    complete_records: complete } = report.summary;
  const lines = [`Изменение: ${report.change_id}`,
    `Записи Tracking: ${tracked}; в работе: ${active}; checkpoint: ${partial}; завершено: ${complete}.`];
  for (const task of report.tasks) {
    lines.push(`${task.needs_attention ? "!" : "•"} ${task.task_id} (${task.repository_id}) — ${task.message}`);
    if (task.note) lines.push(`  Заметка исполнителя: ${task.note}`);
    // Полный следующий шаг нужен при проблеме или раскрытии конкретной задачи.
    if (task.next_step && (task.needs_attention || report.tasks.length === 1)) lines.push(`  Далее: ${task.next_step}`);
    if (task.diff) {
      lines.push(`  ${task.diff.message}`);
      if (task.diff.available) {
        lines.push(`  Новых коммитов: ${task.diff.commit_count}.`);
        for (const file of task.diff.committed_files) lines.push(`    В коммитах: ${JSON.stringify(file)}`);
        for (const file of task.diff.worktree_files) lines.push(`    Не закоммичено: ${JSON.stringify(file)}`);
        if (!task.diff.committed_files.length && !task.diff.worktree_files.length) lines.push("  Изменений в файлах нет.");
      }
    }
  }
  for (const warning of report.warnings) lines.push("", `! ${warning.message}`, `  Далее: ${warning.next_step}`);
  return lines.join("\n");
}

/** Оставляет в результате действия только подтверждённый итог и следующий шаг. */
export function compactOperation(result, input, repositoryId) {
  return { change_id: input.change_id, task_id: input.task_id,
    repository_id: repositoryId, changed: result.changed, message: result.message, next_step: result.next_step };
}

/** Описывает результат по данным, уже проверенным внутри операции; новых чтений нет. */
export function operationMessage(operation, changed, taskId, repositoryId, note) {
  const location = `задача ${taskId} (${repositoryId})`;
  if (operation === "start") return { message: `${changed ? "Начало работы записано" : "Работа уже начата"}: ${location}.`,
    next_step: "Для передачи сохраните committed результат через checkpoint, для завершения — через complete." };
  if (operation === "checkpoint") return {
    message: `${changed ? "Промежуточный результат сохранён" : "Этот промежуточный результат уже сохранён"}: ${location}.` +
      `${note ? ` Заметка исполнителя: ${note.trim()}` : ""}`,
    next_step: "Продолжите работу или передайте Code commit и карту Store обычным Git-процессом." };
  if (operation === "complete") return { message: `${changed ? "Итог реализации записан" : "Этот итог уже записан"}: ${location}.`,
    next_step: null };
  return { message: `${changed ? "Локальная запись работы удалена" : "Локальной записи работы нет"}: ${location}. Сохранённые результаты не изменены. Причина: ${note}`,
    next_step: "Перед продолжением прочитайте status и проверьте выбранную рабочую копию." };
}
