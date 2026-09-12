/** @fileoverview Инструменты и короткое дополнение контекста принадлежат Tracking. */
import { ChangeTrackingApplication } from "./application.js";

const text = { type: "string", minLength: 1 };
const change = { ...text, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const descriptions = {
  start: "Начать или продолжить задачу в текущем Code checkout. task_id — точный ID из OpenSpec Apply. restart только после явной проверки нового плана/checkout.",
  checkpoint: "Сохранить текущий committed результат и необязательную заметку для передачи. Не закрывает задачу и не публикует Git.",
  complete: "Сохранить завершённую реализацию из текущего checkout. Требует выполненную галочку OpenSpec, но не означает успешный Verify.",
  cancel: "Снять локальный курсор работы с причиной. Сохранённая реализация остаётся в Change.",
  status: "Прочитать задачи, состояние реализации и соответствие текущих checkout. candidate — снимок, который сохраняют вместе с evidence проверки.",
};

export const changeTrackingAgentContribution = Object.freeze({
  requireBinding: true,
  create: (context) => new ChangeTrackingApplication(context),
  tools: Object.entries(descriptions).map(([name, description]) => ({
    name: `tracking_${name}`, description,
    inputSchema: { type: "object", properties: { change_id: change,
      ...(name === "status" ? {} : { task_id: text }),
      ...(name === "start" ? { restart: { type: "boolean" } } : {}),
      ...(name === "checkpoint" ? { note: text } : {}),
      ...(name === "cancel" ? { reason: text } : {}) },
    required: name === "status" ? ["change_id"] : name === "cancel" ? ["change_id", "task_id", "reason"] : ["change_id", "task_id"],
    additionalProperties: false },
    annotations: { readOnlyHint: name === "status", destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute(application, input) {
      if (!application) throw new Error("CAPABILITY_UNAVAILABLE: подключите change-tracking к Store");
      return name === "status" ? application.getStatus(input.change_id) : application[name](input);
    },
  })),
  async enhance({ application, operation, input, result }) {
    if (!["getStatus", "getChangeContext"].includes(operation)) return result;
    const status = application && input.change_id ? await application.getStatus(input.change_id) : null;
    return { ...result,
      ...(operation === "getStatus" ? { capabilities: { ...result.capabilities,
        tracking: { provider: "change-tracking", available: application !== null } } } : {}),
      tracking: status ? { change_id: status.change_id, tasks: status.tasks.map((task) => {
        const compact = { ...task };
        delete compact.implementation_revision;
        return compact;
      }), warnings: status.warnings } : null };
  },
});
