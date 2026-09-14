/** @fileoverview Публичный каталог MCP-инструментов и их входные контракты. */

import { MCP_IDENTIFIER_PATTERN, MCP_TOOL_VALIDATORS } from "./tool-validation.js";

const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: "string", minLength: 1 });
const IF_CONTEXT_REVISION_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  description: "Значение context_revision из предыдущего ответа этого инструмента с теми же аргументами. Если " +
    "свежий результат совпадает, возвращается unchanged: true. Это хеш ответа, а не Git revision.",
});
const IDENTIFIER_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  pattern: MCP_IDENTIFIER_PATTERN,
});
const CHANGE_ID_SCHEMA = Object.freeze({
  ...IDENTIFIER_SCHEMA,
  description: "Имя каталога OpenSpec Change в основном Store, без префикса узла графа change:.",
});
const EMPTY_SCHEMA = Object.freeze({ type: "object", additionalProperties: false });
const CHANGE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({ change_id: CHANGE_ID_SCHEMA }),
  additionalProperties: false,
});
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const TOOL_DEFINITIONS = Object.freeze([
  defineMcpTool({
    name: "get_status", applicationMethod: "getStatus",
    description: "Прочитать реестр проекта основного Store, текущий репозиторий вызова, доступность плагинов и состояние Change. Без change_id возвращается состояние проекта; с ним — сведения об отслеживании Change.",
    inputSchema: CHANGE_SCHEMA, annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "get_setup_context", applicationMethod: "getSetupContext",
    description: "Прочитать доступные ID Agent и Template, обязательные Extensions и ограничения инициализации для фиксированного рабочего каталога MCP. Ничего не инициализирует.",
    inputSchema: EMPTY_SCHEMA, annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "get_change_context", applicationMethod: "getChangeContext",
    description: "Прочитать Change из основного Store, определённого по рабочему каталогу MCP. Возвращает состояние артефактов OpenSpec, ресурсы и дополнения подключённых плагинов. Передавайте artifact только для получения его инструкций; артефакты не создаются.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        change_id: CHANGE_ID_SCHEMA,
        artifact: Object.freeze({ ...IDENTIFIER_SCHEMA, description: "ID артефакта из openspec_status.artifacts[].id выбранного Change или apply для инструкций Apply. Без этого аргумента возвращается состояние без инструкций артефакта." }),
        include_assignment: Object.freeze({ type: "boolean", description: "Включить в ответ рабочие копии Code Repository и сведения об их участии в реализации. По умолчанию false; работу не назначает." }),
      }),
      required: ["change_id"], additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "get_next_action", applicationMethod: "getNextAction",
    description: "Прочитать рекомендуемое следующее действие OpenSpec и ответственного участника для Change в основном Store. Действие не выполняется. Без change_id возвращает доступные Changes для выбора пользователем.",
    inputSchema: CHANGE_SCHEMA, annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "get_assignment_scope", applicationMethod: "getAssignmentScope",
    description: "Прочитать рабочие копии Code Repository в проекте основного Store. С change_id подключённые плагины могут уточнить участие репозиториев в этом Change; без него участие неизвестно. Git revision не вычисляется. Работу не назначает и о завершении не сообщает.",
    inputSchema: CHANGE_SCHEMA, annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "get_doctor_report", applicationMethod: "getDoctorReport",
    description: "Запустить диагностику Orchestrator Doctor без изменений для проекта, определённого по фиксированному рабочему каталогу MCP. Возвращает диагностику окружения, репозиториев и плагинов; проблемы не исправляет.",
    inputSchema: EMPTY_SCHEMA, annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineMcpTool({
    name: "initialize_project", applicationMethod: "initializeProject",
    description: "Идемпотентно инициализировать фиксированный рабочий каталог MCP как отдельный центральный Store. Нельзя выбирать рабочую копию Orchestrator, Template или Code Repository. Центральный Store задаётся только через store_id; repositories содержит только необязательные Code Repository.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        store_id: Object.freeze({ ...IDENTIFIER_SCHEMA, description: "Идентификатор нового центрального Store и его ID в реестре. Целевой путь — фиксированный рабочий каталог MCP." }),
        agent_id: Object.freeze({ ...IDENTIFIER_SCHEMA, description: "ID провайдера Agent из get_setup_context. Выбирает интеграцию рабочего процесса, а не модель ИИ." }),
        template_id: Object.freeze({ ...IDENTIFIER_SCHEMA, description: "ID Template из get_setup_context. Без этого аргумента используется Template по умолчанию." }),
        repositories: Object.freeze({
          type: "array", description: "Только необязательные Code Repository. Не включайте центральный Store: он задаётся исключительно через store_id.",
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              repository_id: Object.freeze({ ...IDENTIFIER_SCHEMA, description: "ID нового Code Repository в реестре центрального Store; должен отличаться от store_id." }),
              remote: Object.freeze({ ...NON_EMPTY_STRING_SCHEMA, description: "URL для клонирования этого Code Repository через Git." }),
              default_branch: Object.freeze({ ...NON_EMPTY_STRING_SCHEMA, description: "Существующая ветка, выбираемая при клонировании этого Code Repository." }),
            }),
            required: ["repository_id", "remote", "default_branch"], additionalProperties: false,
          }),
        }),
      }),
      required: ["store_id", "agent_id"], additionalProperties: false,
    }),
    annotations: WRITE_ANNOTATIONS, validate: MCP_TOOL_VALIDATORS.assertInitialization,
  }),
  defineMcpTool({
    name: "connect_project", applicationMethod: "connectProject",
    description: "Подключить проект основного Store, определённого по фиксированному рабочему каталогу MCP, в фиксированном workspace. Может клонировать зарегистрированные репозитории code/specs и установить настроенные материалы и интеграции проекта. Зависимости репозиториев specs рекурсивно не подключаются.",
    inputSchema: EMPTY_SCHEMA, annotations: Object.freeze({ ...WRITE_ANNOTATIONS, openWorldHint: true }),
  }),
]);

export const ORCHESTRATOR_MCP_TOOLS = Object.freeze(TOOL_DEFINITIONS.map(({ tool }) => tool));
export const MCP_APPLICATION_METHODS = Object.freeze([
  ...TOOL_DEFINITIONS.map(({ applicationMethod }) => applicationMethod),
  "listResources", "readResource",
]);

/** Добавляет общий аргумент условного чтения без изменения доменных входных данных. */
function readInputSchema(inputSchema) {
  return Object.freeze({
    ...inputSchema,
    properties: Object.freeze({ ...(inputSchema.properties ?? {}), if_context_revision: IF_CONTEXT_REVISION_SCHEMA }),
  });
}

/** Отделяет публичные метаданные MCP от внутреннего вызова приложения. */
export function defineMcpTool({ agentTool = false, applicationMethod, validate = null, ...tool }) {
  const inputSchema = tool.annotations?.readOnlyHint ? readInputSchema(tool.inputSchema) : tool.inputSchema;
  return Object.freeze({ agentTool, applicationMethod, validate, tool: Object.freeze({ ...tool, inputSchema }) });
}

export { TOOL_DEFINITIONS };
