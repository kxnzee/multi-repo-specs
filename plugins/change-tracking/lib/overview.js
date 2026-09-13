/** @fileoverview Компактный обзор активных Changes, без нового состояния и процентов готовности. */
import { activeChanges } from "./openspec-compatibility.js";
import { compactStatus } from "./presentation.js";

/** Ошибка одного Change не скрывает остальные; ошибка списка не означает пустой Store. */
export async function readTrackingOverview(context, readStatus) {
  const changes = [];
  for (const changeId of await activeChanges(context.process)) {
    try {
      const report = compactStatus(await readStatus(changeId));
      changes.push({ change_id: changeId, summary: report.summary,
        checkpoints: report.summary.total_tasks === null ? null : report.tasks.filter(({ state }) => state === "partial")
          .map(({ task_id, repository_id }) => ({ task_id, repository_id })),
        attention: report.tasks.filter(({ needs_attention }) => needs_attention)
          .map(({ task_id, repository_id, message, next_step }) => ({ task_id, repository_id, message, next_step })),
        warnings: report.warnings });
    } catch {
      changes.push({ change_id: changeId,
        summary: { total_tasks: null, completed_tasks: null, recorded_tasks: null },
        checkpoints: null, attention: [], warnings: [{ code: "TRACKING_STATUS_UNAVAILABLE",
          message: "Не удалось прочитать состояние Change.", next_step: `Запросите status ${changeId} для диагностики.` }] });
    }
  }
  return { changes };
}

/** Один Change — одна строка; задачи и технические подробности раскрываются отдельно. */
export function formatOverview(report) {
  if (!report.changes.length) return "Активных Changes нет.";
  return report.changes.map(({ change_id, summary, checkpoints, attention, warnings }) => {
    const progress = summary.total_tasks === null ? "прогресс неизвестен"
      : `OpenSpec ${summary.completed_tasks}/${summary.total_tasks}; итог записан для ${summary.recorded_tasks} задач`;
    return `${change_id}: ${progress}; checkpoint: ${checkpoints?.length ?? "неизвестно"}; замечания: ${attention.length + warnings.length}.`;
  }).join("\n");
}
