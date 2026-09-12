/** @fileoverview Локальный stdio-транспорт MCP с фиксированным каталогом разрешённых инструментов. */

import { createHash } from "node:crypto";

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const IDENTIFIER_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: "string", minLength: 1 });
const IF_CONTEXT_REVISION_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  description: "Значение context_revision из предыдущего ответа этого инструмента с теми же аргументами. Если " +
    "свежий результат совпадает, возвращается unchanged: true. Это хеш ответа, а не Git revision.",
});
const IDENTIFIER_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  pattern: IDENTIFIER_PATTERN,
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
  defineTool({
    name: "get_status",
    applicationMethod: "getStatus",
    description: "Прочитать реестр проекта основного Store, текущий репозиторий вызова, доступность плагинов и " +
      "состояние Change. Без change_id возвращается состояние проекта; с ним — сведения об " +
      "отслеживании Change.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_setup_context",
    applicationMethod: "getSetupContext",
    description: "Прочитать доступные ID Agent и Template, обязательные Extensions и ограничения инициализации " +
      "для фиксированного рабочего каталога MCP. Ничего не инициализирует.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_change_context",
    applicationMethod: "getChangeContext",
    description: "Прочитать Change из основного Store, определённого по рабочему каталогу MCP. Возвращает " +
      "состояние артефактов OpenSpec, ресурсы и дополнения подключённых плагинов. Передавайте " +
      "artifact только для получения его инструкций; артефакты не создаются.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        change_id: CHANGE_ID_SCHEMA,
        artifact: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "ID артефакта из openspec_status.artifacts[].id выбранного Change или apply для инструкций " +
            "Apply. Без этого аргумента возвращается состояние без инструкций артефакта.",
        }),
        include_assignment: Object.freeze({
          type: "boolean",
          description: "Включить в ответ рабочие копии Code Repository и сведения об их участии в реализации. По " +
            "умолчанию false; работу не назначает.",
        }),
      }),
      required: ["change_id"],
      additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_next_action",
    applicationMethod: "getNextAction",
    description: "Прочитать рекомендуемое следующее действие OpenSpec и ответственного участника для Change в " +
      "основном Store. Действие не выполняется. Без change_id возвращает доступные Changes для выбора " +
      "пользователем.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_assignment_scope",
    applicationMethod: "getAssignmentScope",
    description: "Прочитать рабочие копии Code Repository в проекте основного Store. С change_id подключённые " +
      "плагины могут уточнить участие репозиториев в этом Change; без него участие неизвестно. Git " +
      "revision не вычисляется. Работу не назначает и о завершении не сообщает.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_doctor_report",
    applicationMethod: "getDoctorReport",
    description: "Запустить диагностику Orchestrator Doctor без изменений для проекта, определённого по " +
      "фиксированному рабочему каталогу MCP. Возвращает диагностику окружения, репозиториев и " +
      "плагинов; проблемы не исправляет.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "initialize_project",
    applicationMethod: "initializeProject",
    description: "Идемпотентно инициализировать фиксированный рабочий каталог MCP как отдельный центральный " +
      "Store. Нельзя выбирать рабочую копию Orchestrator, Template или Code Repository. Центральный " +
      "Store задаётся только через store_id; repositories содержит только необязательные Code " +
      "Repository.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        store_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "Идентификатор нового центрального Store и его ID в реестре. Целевой путь — фиксированный " +
            "рабочий каталог MCP.",
        }),
        agent_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "ID провайдера Agent из get_setup_context. Выбирает интеграцию рабочего процесса, а не модель " +
            "ИИ.",
        }),
        template_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "ID Template из get_setup_context. Без этого аргумента используется Template по умолчанию.",
        }),
        repositories: Object.freeze({
          type: "array",
          description: "Только необязательные Code Repository. Не включайте центральный Store: он задаётся " +
            "исключительно через store_id.",
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              repository_id: Object.freeze({
                ...IDENTIFIER_SCHEMA,
                description: "ID нового Code Repository в реестре центрального Store; должен отличаться от store_id.",
              }),
              remote: Object.freeze({
                ...NON_EMPTY_STRING_SCHEMA,
                description: "URL для клонирования этого Code Repository через Git.",
              }),
              default_branch: Object.freeze({
                ...NON_EMPTY_STRING_SCHEMA,
                description: "Существующая ветка, выбираемая при клонировании этого Code Repository.",
              }),
            }),
            required: ["repository_id", "remote", "default_branch"],
            additionalProperties: false,
          }),
        }),
      }),
      required: ["store_id", "agent_id"],
      additionalProperties: false,
    }),
    annotations: WRITE_ANNOTATIONS,
    validate: assertInitialization,
  }),
  defineTool({
    name: "connect_project",
    applicationMethod: "connectProject",
    description: "Подключить проект основного Store, определённого по фиксированному рабочему каталогу MCP, в " +
      "фиксированном workspace. Может клонировать зарегистрированные репозитории code/specs и " +
      "установить настроенные материалы и интеграции проекта. Зависимости репозиториев specs " +
      "рекурсивно не подключаются.",
    inputSchema: EMPTY_SCHEMA,
    annotations: Object.freeze({ ...WRITE_ANNOTATIONS, openWorldHint: true }),
  }),
]);

export const ORCHESTRATOR_MCP_TOOLS = Object.freeze(
  TOOL_DEFINITIONS.map(({ tool }) => tool),
);
const APPLICATION_METHODS = Object.freeze([
  ...TOOL_DEFINITIONS.map(({ applicationMethod }) => applicationMethod),
  "listResources",
  "readResource",
]);

/** Добавляет общий аргумент условного чтения без изменения доменных входных данных. */
function readInputSchema(inputSchema) {
  return Object.freeze({
    ...inputSchema,
    properties: Object.freeze({
      ...(inputSchema.properties ?? {}),
      if_context_revision: IF_CONTEXT_REVISION_SCHEMA,
    }),
  });
}

/** Отделяет публичные метаданные MCP от внутреннего вызова приложения. */
function defineTool({ agentTool = false, applicationMethod, validate = null, ...tool }) {
  const inputSchema = tool.annotations?.readOnlyHint
    ? readInputSchema(tool.inputSchema)
    : tool.inputSchema;
  return Object.freeze({
    agentTool,
    applicationMethod,
    validate,
    tool: Object.freeze({ ...tool, inputSchema }),
  });
}

/** Вычисляет хеш свежего результата с учётом инструмента и аргументов. */
function contextRevision(name, args, value) {
  return createHash("sha256").update(JSON.stringify([name, args, value])).digest("hex");
}

/** Добавляет ревизию результата, сохраняя его публичные поля. */
function revisedValue(value, revision) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ...value, context_revision: revision });
  }
  return Object.freeze({ value, context_revision: revision });
}

/** Кодирует доменное значение в компактный текстовый результат MCP. */
function resultContent(value, { args, conditionalRevision, definition } = {}) {
  let result = value;
  if (definition?.tool.annotations.readOnlyHint) {
    const revision = contextRevision(definition.tool.name, args, value);
    result = conditionalRevision === revision
      ? Object.freeze({ unchanged: true, context_revision: revision })
      : revisedValue(value, revision);
  }
  return Object.freeze({
    content: Object.freeze([{ type: "text", text: JSON.stringify(result) }]),
  });
}

/** Кодирует ожидаемую ошибку инструмента, не завершая stdio-сервер. */
function errorContent(error) {
  return Object.freeze({
    isError: true,
    content: Object.freeze([{
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    }]),
  });
}

/** Проверяет обязательный или необязательный строковый аргумент на непустое значение. */
function assertString(args, field, { required = false, minLength = 1 } = {}) {
  if (args[field] === undefined && !required) return;
  if (typeof args[field] !== "string" || args[field].length < minLength) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть непустой строкой`);
  }
}

/** Проверяет канонический идентификатор Orchestrator/OpenSpec. */
function assertIdentifier(args, field, { required = false } = {}) {
  assertString(args, field, { required });
  if (args[field] !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(args[field])) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть lowercase kebab-case`);
  }
}

/** Проверяет строковые поля, объявленные схемой объекта MCP. */
function assertDeclaredStrings(name, args, inputSchema) {
  const required = new Set(inputSchema.required ?? []);
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (fieldSchema.type !== "string") continue;
    assertString(args, field, { required: required.has(field), minLength: fieldSchema.minLength ?? 0 });
    if (args[field] === undefined) continue;
    if (fieldSchema.pattern === IDENTIFIER_PATTERN) {
      assertIdentifier(args, field, { required: required.has(field) });
    }
    if (fieldSchema.enum && !fieldSchema.enum.includes(args[field])) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} неизвестен`);
    }
  }
}

/** Проверяет нестроковые скалярные поля, объявленные схемой MCP. */
function assertDeclaredScalars(name, args, inputSchema) {
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (args[field] === undefined || fieldSchema.type === "string") continue;
    if (fieldSchema.type === "boolean" && typeof args[field] !== "boolean") {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} должен быть логическим значением (boolean)`);
    }
  }
}

/** Проверяет объект по полям, объявленным схемой MCP. */
function assertObjectShape(name, args, inputSchema) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} аргументы должны быть объектом`);
  }
  const allowed = new Set(Object.keys(inputSchema.properties ?? {}));
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} не принимает ${unknown}`);
  assertDeclaredStrings(name, args, inputSchema);
  assertDeclaredScalars(name, args, inputSchema);
}

/** Удаляет метаданные условного чтения перед вызовом приложения. */
function applicationArguments(definition, args) {
  if (!definition.tool.annotations.readOnlyHint) return args;
  const applicationArgs = { ...args };
  delete applicationArgs.if_context_revision;
  return applicationArgs;
}

/** Проверяет структурированные аргументы инициализации. */
function assertInitialization(args, inputSchema) {
  if (args.repositories === undefined) return;
  if (!Array.isArray(args.repositories)) {
    throw new Error("MCP_TOOL_INPUT_INVALID: repositories должен быть массивом");
  }
  const repositorySchema = inputSchema.properties.repositories.items;
  const repositoryFields = Object.keys(repositorySchema.properties);
  const ids = new Set();
  for (const repository of args.repositories) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository должен быть объектом");
    }
    const keys = Object.keys(repository);
    if (
      keys.length !== repositoryFields.length ||
      keys.some((key) => !repositoryFields.includes(key))
    ) {
      throw new Error("MCP_TOOL_INPUT_INVALID: контракт repository несовместим");
    }
    assertObjectShape("repository", repository, repositorySchema);
    if (repository.repository_id === args.store_id) {
      throw new Error(
        `STORE_INCLUDED_AS_CODE: Store уже задан через store_id; удалите ` +
          `${repository.repository_id} из repositories и не меняйте store_id`,
      );
    }
    if (ids.has(repository.repository_id)) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: повторяющийся repository_id ${repository.repository_id}`);
    }
    ids.add(repository.repository_id);
  }
}

/** Проверяет аргументы, даже если клиент игнорирует опубликованную JSON Schema. */
function assertArguments(definition, args) {
  const { tool, validate } = definition;
  assertObjectShape(tool.name, args, tool.inputSchema);
  if (validate) validate(args, tool.inputSchema);
}

/** Создаёт независимый от транспорта сервер для тестов и работы через stdio. */
export function createOrchestratorMcpServer(application) {
  if (
    !application ||
    APPLICATION_METHODS.some((method) => typeof application[method] !== "function") ||
    typeof application.invokeAgentTool !== "function" ||
    !Array.isArray(application.agentTools)
  ) {
    throw new Error("MCP_SERVER_INVALID: контракт приложения неполон");
  }
  const agentDefinitions = application.agentTools.map((tool) => defineTool({
    ...tool,
    agentTool: true,
  }));
  const firstWrite = TOOL_DEFINITIONS.findIndex(({ tool }) => !tool.annotations.readOnlyHint);
  const definitions = Object.freeze([
    ...TOOL_DEFINITIONS.slice(0, firstWrite),
    ...agentDefinitions,
    ...TOOL_DEFINITIONS.slice(firstWrite),
  ]);
  const names = definitions.map(({ tool }) => tool.name);
  if (new Set(names).size !== names.length) {
    throw new Error("MCP_SERVER_INVALID: повторяющееся имя инструмента");
  }
  const tools = Object.freeze(definitions.map(({ tool }) => tool));
  const definitionByName = new Map(definitions.map((definition) => [definition.tool.name, definition]));
  const validator = new AjvJsonSchemaValidator();
  const schemaValidators = new Map(definitions.map(({ tool }) => [
    tool.name, validator.getValidator(tool.inputSchema),
  ]));
  const server = new Server(
    { name: "openspec-orchestrator", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  const availableTools = async () => {
    if (typeof application.listAgentTools !== "function") return tools;
    const visible = new Set((await application.listAgentTools()).map(({ name }) => name));
    return definitions.filter((item) => !item.agentTool || visible.has(item.tool.name)).map(({ tool }) => tool);
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await availableTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    const definition = definitionByName.get(request.params.name);
    if (!definition) {
      return errorContent(new Error(`MCP_TOOL_NOT_FOUND: ${request.params.name}`));
    }
    try {
      if (definition.agentTool && !(await availableTools()).some(({ name }) => name === definition.tool.name)) {
        throw new Error(`MCP_TOOL_NOT_FOUND: ${definition.tool.name}`);
      }
      if (!definition.agentTool) assertArguments(definition, args);
      const validation = schemaValidators.get(definition.tool.name)(args);
      if (!validation.valid) {
        throw new Error(`MCP_TOOL_INPUT_INVALID: ${definition.tool.name}: ${validation.errorMessage}`);
      }
      const input = applicationArguments(definition, args);
      const value = definition.agentTool
        ? await application.invokeAgentTool(definition.tool.name, input)
        : await application[definition.applicationMethod](input);
      return resultContent(value, {
        args: input,
        conditionalRevision: args.if_context_revision,
        definition,
      });
    } catch (error) {
      return errorContent(error);
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await application.listResources(),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = await application.readResource(request.params.uri);
    return {
      contents: [{
        uri: resource.uri,
        mimeType: resource.mimeType,
        text: resource.text,
        ...(resource._meta?.source || resource._meta?.diagnostic ? { _meta: resource._meta } : {}),
      }],
    };
  });
  return server;
}

/** Запускает единственный поддерживаемый транспорт: локальный stdio. */
export async function serveOrchestratorMcpStdio(application) {
  const server = createOrchestratorMcpServer(application);
  await server.connect(new StdioServerTransport());
  return server;
}
