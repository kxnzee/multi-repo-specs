/** @fileoverview Инструменты и короткое дополнение контекста принадлежат Tracking. */
import { ChangeTrackingApplication } from "./application.js";
import { compactOperation, compactStatus } from "./presentation.js";

const text = { type: "string", minLength: 1 };
const change = { ...text, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const descriptions = {
  start: "Начать или продолжить отслеживание task_id в текущем Code checkout. restart явно начинает новую локальную работу от текущей revision.",
  checkpoint: "Сохранить текущий committed результат и необязательную заметку для передачи. Не меняет OpenSpec и не публикует Git.",
  complete: "Сохранить revision текущего чистого Code checkout и закрыть локальную сессию. Не меняет OpenSpec и не подтверждает проверки.",
  cancel: "Снять локальный курсор работы с причиной. Сохранённая реализация остаётся в Change.",
  status: "Checkbox из публичного OpenSpec API рядом с наличием revision и состоянием checkout. all:true показывает активные Changes; diff:true — изменения после сохранённой точки.",
};

export const changeTrackingAgentContribution = Object.freeze({
  requireBinding: true,
  create: (context) => new ChangeTrackingApplication(context),
  tools: Object.entries(descriptions).map(([name, description]) => ({
    name: `tracking_${name}`, description,
    inputSchema: { type: "object", properties: { change_id: change,
      task_id: text,
      ...(name === "status" ? { details: { type: "boolean" }, all: { type: "boolean" }, diff: { type: "boolean" } } : {}),
      ...(name === "start" ? { restart: { type: "boolean" } } : {}),
      ...(name === "checkpoint" ? { note: text } : {}),
      ...(name === "cancel" ? { reason: text } : {}) },
    required: name === "status" ? [] : name === "cancel" ? ["change_id", "task_id", "reason"] : ["change_id", "task_id"],
    additionalProperties: false },
    annotations: { readOnlyHint: name === "status", destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(application, input) {
      if (!application) throw new Error("CAPABILITY_UNAVAILABLE: подключите change-tracking к Store");
      if (name === "status") {
        const report = await application.getStatus(input.change_id, { task_id: input.task_id, all: input.all, diff: input.diff });
        return input.details ? report : compactStatus(report);
      }
      return compactOperation(await application[name](input), input, application.context.invocation.id);
    },
  })),
  async enhance({ application, operation, input, result }) {
    if (operation !== "getStatus") return result;
    let status = null;
    let diagnostic;
    if (application && input.change_id) {
      try { status = await application.getStatus(input.change_id); }
      catch (error) {
        // Ошибка необязательного дополнения не скрывает уже прочитанный Core status.
        diagnostic = { code: "TRACKING_STATUS_UNAVAILABLE", message: error.message };
      }
    }
    return { ...result,
      capabilities: { ...result.capabilities,
        tracking: { provider: "change-tracking", available: application !== null && !diagnostic,
          ...(diagnostic ? { diagnostic } : {}) } },
      tracking: status ? compactStatus(status) : null };
  },
});
