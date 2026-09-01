/** @fileoverview CLI fallback for the task-to-revision workflow. */

import { COMMAND_SCOPE } from "@openspec-orch/plugin-sdk";

import { ChangeTrackingApplication } from "./application.js";

/** Registers one narrow command group without owning Git publication. */
export function registerChangeTrackingCommands(commands, { output = console } = {}) {
  const write = (message) => output.log(message);
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
}
