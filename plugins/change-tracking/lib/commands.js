/** @fileoverview Короткий CLI одного процесса Tracking. */
import { COMMAND_SCOPE } from "@openspec-orch/plugin-sdk";
import { ChangeTrackingApplication } from "./application.js";

/** Команды используют один application и не требуют ручного ввода Git данных. */
export function registerChangeTrackingCommands(commands, { output = console } = {}) {
  for (const name of ["start", "checkpoint", "complete", "cancel"]) {
    const command = commands.command(`${name} <change-id> <task-id>${name === "cancel" ? " <reason>" : ""}`)
      .description({ start: "начать или продолжить задачу", checkpoint: "сохранить промежуточную реализацию",
        complete: "зафиксировать завершённую реализацию", cancel: "отменить локальную работу, сохранив checkpoint" }[name]);
    if (name === "start") command.option("--restart", "явно начать заново после проверки изменённого плана или checkout");
    if (name === "checkpoint") command.option("--note <text>", "короткая заметка следующему исполнителю");
    command.actionWithContext(async (context, changeId, taskId, ...rest) => {
      const options = name === "cancel" ? {} : rest[0];
      const input = { change_id: changeId, task_id: taskId,
        ...(name === "cancel" ? { reason: rest[0] } : {}),
        ...(options?.restart ? { restart: true } : {}), ...(options?.note ? { note: options.note } : {}) };
      const result = await new ChangeTrackingApplication(context)[name](input);
      output.log(`${name}: ${result.changed ? "сохранено" : "без изменений"} — ${context.invocation.id}, задача ${taskId}`);
    }, { scope: COMMAND_SCOPE.store });
  }
  commands.command("status <change-id>").description("задачи, записи реализации и соответствие checkout")
    .option("--json", "полные машинные данные, включая revisions кандидата")
    .actionWithContext(async (context, changeId, options) => {
      const result = await new ChangeTrackingApplication(context).getStatus(changeId);
      if (options.json) { output.log(JSON.stringify(result, null, 2)); return; }
      output.log(`Change: ${changeId}`);
      for (const task of result.tasks) output.log(`${task.task_id}  ${task.repository_id ?? "—"}  ${task.state}` +
        `  OpenSpec: ${task.task_done === null ? "неизвестно" : task.task_done ? "готово" : "открыто"}` +
        `${task.checkout ? `  checkout: ${task.checkout}` : ""}${task.note ? `  ${task.note}` : ""}`);
      for (const warning of result.warnings) output.log(`${warning.code}: ${warning.message}`);
    }, { scope: COMMAND_SCOPE.store });
}
