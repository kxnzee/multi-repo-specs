/** @fileoverview Local stdio MCP transport with a fixed governed tool catalog. */

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
const IDENTIFIER_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  pattern: IDENTIFIER_PATTERN,
});
const EMPTY_SCHEMA = Object.freeze({ type: "object", additionalProperties: false });
const CHANGE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({ change_id: IDENTIFIER_SCHEMA }),
  additionalProperties: false,
});
const ATTEMPT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    change_id: IDENTIFIER_SCHEMA,
    task_id: NON_EMPTY_STRING_SCHEMA,
  }),
  required: ["change_id", "task_id"],
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
    description: "Read current Project, Repository, Plugin and Change status.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_setup_context",
    applicationMethod: "getSetupContext",
    description: "Read exact Agent and Template choices, required Extensions and setup constraints.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_change_context",
    applicationMethod: "getChangeContext",
    description: "Read exact OpenSpec status, artifact instructions and optional Plugin overlays.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        change_id: IDENTIFIER_SCHEMA,
        artifact: IDENTIFIER_SCHEMA,
      }),
      required: ["change_id"],
      additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_next_action",
    applicationMethod: "getNextAction",
    description: "Derive the next governed action and the actor allowed to perform it.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_assignment_scope",
    applicationMethod: "getAssignmentScope",
    description: "Read all Code Repository assignments, checkouts, revisions and Graph impact.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_doctor_report",
    applicationMethod: "getDoctorReport",
    description: "Run the same read-only Orchestrator Doctor used by CLI.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "query_graph",
    applicationMethod: "queryGraph",
    description: "Compile the Store graph and run a report, node or Change-impact query.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        query: Object.freeze({ type: "string", enum: ["report", "node", "change_impact"] }),
        id: NON_EMPTY_STRING_SCHEMA,
      }),
      required: ["query"],
      additionalProperties: false,
      oneOf: Object.freeze([
        Object.freeze({ properties: Object.freeze({ query: Object.freeze({ const: "report" }) }) }),
        Object.freeze({
          properties: Object.freeze({
            query: Object.freeze({ enum: ["node", "change_impact"] }),
          }),
          required: ["id"],
        }),
      ]),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
    validate: assertGraphQuery,
  }),
  defineTool({
    name: "initialize_project",
    applicationMethod: "initializeProject",
    description: "Idempotently initialize only the MCP cwd in strict mode through Core.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        store_id: IDENTIFIER_SCHEMA,
        agent_id: IDENTIFIER_SCHEMA,
        template_id: IDENTIFIER_SCHEMA,
        repositories: Object.freeze({
          type: "array",
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              repository_id: IDENTIFIER_SCHEMA,
              remote: NON_EMPTY_STRING_SCHEMA,
              default_branch: NON_EMPTY_STRING_SCHEMA,
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
    description: "Idempotently connect the current strict Project; may clone registered repositories.",
    inputSchema: EMPTY_SCHEMA,
    annotations: Object.freeze({ ...WRITE_ANNOTATIONS, openWorldHint: true }),
  }),
  defineTool({
    name: "start_attempt",
    applicationMethod: "startAttempt",
    description: "Start local evidence for one canonical OpenSpec Apply task in the current Code Repository.",
    inputSchema: ATTEMPT_SCHEMA,
    annotations: WRITE_ANNOTATIONS,
  }),
  defineTool({
    name: "complete_attempt",
    applicationMethod: "completeAttempt",
    description: "Map one completed OpenSpec Apply task to the current clean Code Repository revision.",
    inputSchema: ATTEMPT_SCHEMA,
    annotations: WRITE_ANNOTATIONS,
  }),
]);

export const ORCHESTRATOR_MCP_TOOLS = Object.freeze(
  TOOL_DEFINITIONS.map(({ tool }) => tool),
);
const TOOL_DEFINITION_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((definition) => [definition.tool.name, definition]),
);
const APPLICATION_METHODS = Object.freeze([
  ...TOOL_DEFINITIONS.map(({ applicationMethod }) => applicationMethod),
  "listResources",
  "readResource",
]);

/** Separates public MCP metadata from its private application dispatch. */
function defineTool({ applicationMethod, validate = null, ...tool }) {
  return Object.freeze({
    applicationMethod,
    validate,
    tool: Object.freeze(tool),
  });
}

/** Encodes a domain value as one MCP text result. */
function resultContent(value) {
  return Object.freeze({
    content: Object.freeze([{ type: "text", text: JSON.stringify(value, null, 2) }]),
  });
}

/** Encodes an expected tool failure without terminating the stdio server. */
function errorContent(error) {
  return Object.freeze({
    isError: true,
    content: Object.freeze([{
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    }]),
  });
}

/** Validates one optional or required non-empty string argument. */
function assertString(args, field, { required = false } = {}) {
  if (args[field] === undefined && !required) return;
  if (typeof args[field] !== "string" || args[field].length === 0) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть непустой строкой`);
  }
}

/** Requires one canonical Orchestrator/OpenSpec identifier. */
function assertIdentifier(args, field, { required = false } = {}) {
  assertString(args, field, { required });
  if (args[field] !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(args[field])) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть lowercase kebab-case`);
  }
}

/** Validates the string fields declared by one advertised object schema. */
function assertDeclaredStrings(name, args, inputSchema) {
  const required = new Set(inputSchema.required ?? []);
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (fieldSchema.type !== "string") continue;
    assertString(args, field, { required: required.has(field) });
    if (args[field] === undefined) continue;
    if (fieldSchema.pattern === IDENTIFIER_PATTERN) {
      assertIdentifier(args, field, { required: required.has(field) });
    }
    if (fieldSchema.enum && !fieldSchema.enum.includes(args[field])) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} неизвестен`);
    }
  }
}

/** Validates one object against the fields advertised by its MCP schema. */
function assertObjectShape(name, args, inputSchema) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} arguments должны быть object`);
  }
  const allowed = new Set(Object.keys(inputSchema.properties ?? {}));
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} не принимает ${unknown}`);
  assertDeclaredStrings(name, args, inputSchema);
}

/** Validates the structured strict-init surface. */
function assertInitialization(args, inputSchema) {
  if (args.repositories === undefined) return;
  if (!Array.isArray(args.repositories)) {
    throw new Error("MCP_TOOL_INPUT_INVALID: repositories должен быть array");
  }
  const repositorySchema = inputSchema.properties.repositories.items;
  const repositoryFields = Object.keys(repositorySchema.properties);
  const ids = new Set();
  for (const repository of args.repositories) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository должен быть object");
    }
    const keys = Object.keys(repository);
    if (
      keys.length !== repositoryFields.length ||
      keys.some((key) => !repositoryFields.includes(key))
    ) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository contract несовместим");
    }
    assertObjectShape("repository", repository, repositorySchema);
    if (ids.has(repository.repository_id)) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: повторяющийся repository_id ${repository.repository_id}`);
    }
    ids.add(repository.repository_id);
  }
}

/** Validates the conditional Graph query contract. */
function assertGraphQuery(args) {
  assertString(args, "id", { required: args.query !== "report" });
}

/** Validates inputs even when a client ignores the advertised JSON Schema. */
function assertArguments(definition, args) {
  const { tool, validate } = definition;
  assertObjectShape(tool.name, args, tool.inputSchema);
  if (validate) validate(args, tool.inputSchema);
}

/** Creates a transport-independent server for tests and stdio delivery. */
export function createOrchestratorMcpServer(application) {
  if (
    !application ||
    APPLICATION_METHODS.some((method) => typeof application[method] !== "function")
  ) {
    throw new Error("MCP_SERVER_INVALID: application contract incomplete");
  }
  const server = new Server(
    { name: "openspec-orchestrator", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ORCHESTRATOR_MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    const definition = TOOL_DEFINITION_BY_NAME.get(request.params.name);
    if (!definition) {
      return errorContent(new Error(`MCP_TOOL_NOT_FOUND: ${request.params.name}`));
    }
    try {
      assertArguments(definition, args);
      return resultContent(await application[definition.applicationMethod](args));
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
      }],
    };
  });
  return server;
}

/** Starts the only supported transport: local stdio. */
export async function serveOrchestratorMcpStdio(application) {
  const server = createOrchestratorMcpServer(application);
  await server.connect(new StdioServerTransport());
  return server;
}
