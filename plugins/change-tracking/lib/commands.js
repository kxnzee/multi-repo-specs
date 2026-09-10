/** @fileoverview CLI fallback for the task-to-revision workflow. */

import { COMMAND_SCOPE } from "@openspec-orch/plugin-sdk";

import { ChangeTrackingApplication } from "./application.js";

/** Registers one narrow command group without owning Git publication. */
export function registerChangeTrackingCommands(commands, { output = console } = {}) {
  const write = (message) => output.log(message);
  commands.command("record <change-id> <task-id>")
    .description("сохранить частичную или завершённую реализацию в Change без локальной attempt")
    .option("--description <text>", "точное описание OpenSpec task", { required: true })
    .option("--pr <url>", "ссылка на Code PR", { required: true })
    .option("--previous-task <id>", "явно перепривязать связь прежней задачи с тем же PR")
    .option("--plan <url>", "ссылка на план в PR")
    .option("--commits <sha,...>", "полные SHA через запятую")
    .option("--summary <text>", "что сделано и проверено", { required: true })
    .option("--remaining <text>", "что осталось; пустая строка при завершении", { required: true })
    .option("--version <number>", "версия связи из status; 0 для новой", { required: true })
    .actionWithContext(async (context, changeId, taskId, options) => {
      const result = await new ChangeTrackingApplication(context).recordImplementation({
        change_id: changeId, task_id: taskId, task_description: options.description,
        pull_request: options.pr, ...(options.plan ? { plan_url: options.plan } : {}),
        ...(options.previousTask ? { previous_task_id: options.previousTask } : {}),
        commits: options.commits ? options.commits.split(",") : [],
        summary: options.summary, remaining: options.remaining,
        expected_version: /^\d+$/u.test(options.version) ? Number(options.version) : NaN,
      });
      write(JSON.stringify(result, null, 2));
    }, { scope: COMMAND_SCOPE.store });
  commands.command("status <change-id>")
    .description("прочитать связи реализации и актуальные галочки OpenSpec")
    .actionWithContext(async (context, changeId) => {
      write(JSON.stringify(await new ChangeTrackingApplication(context).getStatus(changeId), null, 2));
    }, { scope: COMMAND_SCOPE.store });
  const attempt = commands.command("attempt")
    .description("связать OpenSpec task с ревизией Code Repository");

  attempt.command("start <change-id> <task-id>")
    .description("начать локальную implementation attempt без изменения Store Git")
    .actionWithContext(async (context, changeId, taskId) => {
      const result = await new ChangeTrackingApplication(context).startAttempt({
        changeId,
        taskId,
      });
      write(
        `Attempt ${result.changed ? "начата" : "уже активна"}: ` +
        `${result.repository_id} task ${result.task.id} @ ${result.base_revision}`,
      );
    }, { scope: COMMAND_SCOPE.store });

  attempt.command("complete <change-id> <task-id>")
    .description("зафиксировать выполненный OpenSpec task в манифесте Change")
    .actionWithContext(async (context, changeId, taskId) => {
      const result = await new ChangeTrackingApplication(context).completeAttempt({
        changeId,
        taskId,
      });
      write(
        `Attempt зафиксирована: ${result.attempt.repository_id} task ` +
        `${result.attempt.task.id} @ ${result.attempt.implementation_revision}`,
      );
      write(`Implementation map: ${result.path}`);
    }, { scope: COMMAND_SCOPE.store });
  attempt.command("cancel <change-id> <task-id> <reason>")
    .description("отменить локальную attempt с сохранением причины; не изменяет task и Git")
    .actionWithContext(async (context, changeId, taskId, reason) => {
      const result = await new ChangeTrackingApplication(context).cancelAttempt({ changeId, taskId, reason });
      write(`Attempt отменена: ${result.attempt.repository_id} task ${result.attempt.task.id}. Причина: ${result.reason}`);
    }, { scope: COMMAND_SCOPE.store });

}
