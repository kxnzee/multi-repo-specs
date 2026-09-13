/** @fileoverview Инструменты и короткое дополнение контекста принадлежат Tracking. */
import { ChangeTrackingApplication } from "./application.js";
import { compactOperation, compactStatus } from "./presentation.js";

const text = { type: "string", minLength: 1 };
const change = { ...text, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const descriptions = {
  start: "Начать или продолжить задачу в текущем Code checkout. task_id — точный ID из OpenSpec Apply. restart только после явной проверки нового плана/checkout.",
  checkpoint: "Сохранить текущий committed результат и необязательную заметку для передачи. Не закрывает задачу и не публикует Git.",
  complete: "Сохранить завершённую реализацию из текущего checkout. Требует выполненную галочку OpenSpec, но не означает успешный Verify.",
  cancel: "Снять локальный курсор работы с причиной. Сохранённая реализация остаётся в Change.",
  status: "Краткий статус Change или обзор активных Changes с all:true вместо change_id. task_id раскрывает задачу; diff:true добавляет изменения всего Repository после сохранённой точки этой задачи. details добавляет revisions и candidate для evidence.",
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
    if (!["getStatus", "getChangeContext"].includes(operation)) return result;
    const status = application && input.change_id ? await application.getStatus(input.change_id) : null;
    return { ...result,
      ...(operation === "getStatus" ? { capabilities: { ...result.capabilities,
        tracking: { provider: "change-tracking", available: application !== null } } } : {}),
      tracking: status ? compactStatus(status) : null };
  },
});
