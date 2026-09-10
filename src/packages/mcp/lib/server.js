/** @fileoverview Локальный stdio-транспорт MCP с фиксированным каталогом разрешённых инструментов. */

import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  defineMcpTool,
  MCP_APPLICATION_METHODS,
  ORCHESTRATOR_MCP_TOOLS,
  TOOL_DEFINITIONS,
} from "./tool-contract.js";
import { toolErrorContent, toolResultContent } from "./tool-response.js";
import { assertToolArguments } from "./tool-validation.js";

/** Удаляет метаданные условного чтения перед вызовом приложения. */
function applicationArguments(definition, args) {
  if (!definition.tool.annotations.readOnlyHint) return args;
  const applicationArgs = { ...args };
  delete applicationArgs.if_context_revision;
  return applicationArgs;
}

/** Создаёт независимый от транспорта сервер для тестов и работы через stdio. */
export function createOrchestratorMcpServer(application) {
  if (
    !application ||
    MCP_APPLICATION_METHODS.some((method) => typeof application[method] !== "function") ||
    typeof application.invokeAgentTool !== "function" ||
    !Array.isArray(application.agentTools)
  ) {
    throw new Error("MCP_SERVER_INVALID: контракт приложения неполон");
  }
  const agentDefinitions = application.agentTools.map((tool) => defineMcpTool({
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
    if (!definition) return toolErrorContent(new Error(`MCP_TOOL_NOT_FOUND: ${request.params.name}`));
    try {
      if (definition.agentTool && !(await availableTools()).some(({ name }) => name === definition.tool.name)) {
        throw new Error(`MCP_TOOL_NOT_FOUND: ${definition.tool.name}`);
      }
      if (!definition.agentTool) assertToolArguments(definition, args);
      const validation = schemaValidators.get(definition.tool.name)(args);
      if (!validation.valid) {
        throw new Error(`MCP_TOOL_INPUT_INVALID: ${definition.tool.name}: ${validation.errorMessage}`);
      }
      const input = applicationArguments(definition, args);
      const value = definition.agentTool
        ? await application.invokeAgentTool(definition.tool.name, input)
        : await application[definition.applicationMethod](input);
      return toolResultContent(value, {
        args: input,
        conditionalRevision: args.if_context_revision,
        definition,
      });
    } catch (error) {
      return toolErrorContent(error);
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

export { ORCHESTRATOR_MCP_TOOLS };
