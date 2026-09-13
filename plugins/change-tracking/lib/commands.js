/** @fileoverview Короткий CLI одного процесса Tracking. */
import { COMMAND_SCOPE } from "@openspec-orch/plugin-sdk";
import { ChangeTrackingApplication } from "./application.js";
import { formatStatus } from "./presentation.js";
import { formatOverview } from "./overview.js";

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
      output.log(`${result.message}\nДалее: ${result.next_step}`);
    }, { scope: COMMAND_SCOPE.store });
  }
  commands.command("status [change-id]").description("задачи, записи реализации и соответствие checkout")
    .option("--all", "краткий обзор всех активных Changes OpenSpec")
    .option("--task <task-id>", "раскрыть точную задачу и контекст продолжения")
    .option("--diff", "изменения Repository после сохранённой точки выбранной задачи")
    .option("--json", "полные машинные данные, включая revisions кандидата")
    .actionWithContext(async (context, changeId, options) => {
      const result = await new ChangeTrackingApplication(context).getStatus(changeId,
        { task_id: options.task, all: options.all, diff: options.diff });
      if (options.json) { output.log(JSON.stringify(result, null, 2)); return; }
      output.log(options.all ? formatOverview(result) : formatStatus(result));
    }, { scope: COMMAND_SCOPE.store });
}
