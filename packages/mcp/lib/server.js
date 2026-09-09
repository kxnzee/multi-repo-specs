/** @fileoverview Local stdio MCP transport with a fixed governed tool catalog. */

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
  description: "context_revision from a previous response to this same tool with the same arguments. " +
    "Returns unchanged: true if the freshly read result matches. This is a response digest, not a Git revision.",
});
const IDENTIFIER_SCHEMA = Object.freeze({
  ...NON_EMPTY_STRING_SCHEMA,
  pattern: IDENTIFIER_PATTERN,
});
const CHANGE_ID_SCHEMA = Object.freeze({
  ...IDENTIFIER_SCHEMA,
  description: "OpenSpec Change directory name in the main Store, without the change: graph-node prefix.",
});
const EMPTY_SCHEMA = Object.freeze({ type: "object", additionalProperties: false });
const CHANGE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({ change_id: CHANGE_ID_SCHEMA }),
  additionalProperties: false,
});
const ATTEMPT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    change_id: CHANGE_ID_SCHEMA,
    task_id: Object.freeze({
      ...NON_EMPTY_STRING_SCHEMA,
      description: "Exact tasks[].id from get_change_context with artifact: apply " +
        "(artifact_instructions.tasks). Copy the returned string; do not use a Markdown " +
        "task number such as 1.1 or 2.3 from description, or calculate an array index.",
    }),
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
    description: "Read the main Store project registry, current invocation repository, Plugin " +
      "availability and Change status. Omit change_id for project status; provide it for " +
      "Change tracking details.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_setup_context",
    applicationMethod: "getSetupContext",
    description: "Read available Agent and Template IDs, required Extensions, and initialization " +
      "constraints for the fixed MCP working directory. Does not initialize anything.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_change_context",
    applicationMethod: "getChangeContext",
    description: "Read a Change in the main Store resolved from the MCP working directory. Includes " +
      "OpenSpec artifact status, resources and optional Plugin overlays. Supply artifact " +
      "only to request its instructions; this does not create artifacts.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        change_id: CHANGE_ID_SCHEMA,
        artifact: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "Artifact ID from openspec_status.artifacts[].id for the selected Change, or " +
            "apply for Apply instructions. Omit to read status without artifact " +
            "instructions.",
        }),
        include_assignment: Object.freeze({
          type: "boolean",
          description: "Include Code Repository checkout and assignment information in this response. " +
            "Defaults to false; does not assign work.",
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
    description: "Read the next suggested OpenSpec action and responsible actor for a Change in the " +
      "main Store. Does not execute the action. Without change_id, returns available " +
      "Changes and asks the human to choose.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_assignment_scope",
    applicationMethod: "getAssignmentScope",
    description: "Read Code Repository checkouts and Git revisions in the main Store project. With " +
      "change_id, the Graph overlay marks repositories affected by that Change; without it, " +
      "assignment is unknown. Does not assign work or report completion.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "get_doctor_report",
    applicationMethod: "getDoctorReport",
    description: "Run read-only Orchestrator Doctor for the project resolved from the fixed MCP " +
      "working directory. Reports environment, repository and Plugin diagnostics; does not " +
      "repair them.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  defineTool({
    name: "initialize_project",
    applicationMethod: "initializeProject",
    description: "Idempotently initialize the fixed MCP cwd when it is a " +
      "separate central Store directory. Never target an Orchestrator, Template, " +
      "or Code Repository checkout. Pass the central Store only as store_id; repositories " +
      "contains optional Code Repositories only.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        store_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "New central Store identity and registry ID. The target path is the fixed MCP " +
            "working directory.",
        }),
        agent_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "Agent provider ID from get_setup_context. This selects workflow integration, " +
            "not an AI model.",
        }),
        template_id: Object.freeze({
          ...IDENTIFIER_SCHEMA,
          description: "Template ID from get_setup_context. Omit to use the default Template.",
        }),
        repositories: Object.freeze({
          type: "array",
          description: "Optional Code Repositories only. Never include the central Store; " +
            "it is declared only by store_id.",
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              repository_id: Object.freeze({
                ...IDENTIFIER_SCHEMA,
                description: "New Code Repository ID in the central Store registry; distinct from store_id.",
              }),
              remote: Object.freeze({
                ...NON_EMPTY_STRING_SCHEMA,
                description: "Git clone URL of this Code Repository.",
              }),
              default_branch: Object.freeze({
                ...NON_EMPTY_STRING_SCHEMA,
                description: "Existing branch to check out when cloning this Code Repository.",
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
    description: "Connect the main Store project resolved from the fixed MCP working directory in " +
      "the fixed workspace. May clone registered code/specs repositories and install configured " +
      "project assets and integrations. Does not recursively connect dependencies of specs " +
      "repositories.",
    inputSchema: EMPTY_SCHEMA,
    annotations: Object.freeze({ ...WRITE_ANNOTATIONS, openWorldHint: true }),
  }),
  defineTool({
    name: "start_attempt",
    applicationMethod: "startAttempt",
    description: "Start local evidence for one canonical OpenSpec Apply task from the main Store, in " +
      "the Code Repository containing the fixed MCP working directory. Requires a Code " +
      "Repository; does not execute the task or select a repository.",
    inputSchema: ATTEMPT_SCHEMA,
    annotations: WRITE_ANNOTATIONS,
  }),
  defineTool({
    name: "complete_attempt",
    applicationMethod: "completeAttempt",
    description: "Map one completed OpenSpec Apply task from the main Store to the clean Git revision of the Code Repository containing the fixed MCP working directory. " +
      "Use the canonical task_id from start_attempt. Does not mark the task checkbox; " +
      "the task must already be marked done by Apply.",
    inputSchema: ATTEMPT_SCHEMA,
    annotations: WRITE_ANNOTATIONS,
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

/** Adds one common conditional-read argument without changing domain tool inputs. */
function readInputSchema(inputSchema) {
  return Object.freeze({
    ...inputSchema,
    properties: Object.freeze({
      ...(inputSchema.properties ?? {}),
      if_context_revision: IF_CONTEXT_REVISION_SCHEMA,
    }),
  });
}

/** Separates public MCP metadata from its private application dispatch. */
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

/** Produces a tool-and-input-scoped digest of one freshly resolved read result. */
function contextRevision(name, args, value) {
  return createHash("sha256").update(JSON.stringify([name, args, value])).digest("hex");
}

/** Adds a revision to an object result without hiding its existing public fields. */
function revisedValue(value, revision) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ...value, context_revision: revision });
  }
  return Object.freeze({ value, context_revision: revision });
}

/** Encodes a domain value as one compact MCP text result. */
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

/** Validates non-string scalar fields declared by one advertised object schema. */
function assertDeclaredScalars(name, args, inputSchema) {
  for (const [field, fieldSchema] of Object.entries(inputSchema.properties ?? {})) {
    if (args[field] === undefined || fieldSchema.type === "string") continue;
    if (fieldSchema.type === "boolean" && typeof args[field] !== "boolean") {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${name}.${field} должен быть boolean`);
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
  assertDeclaredScalars(name, args, inputSchema);
}

/** Removes transport-level conditional-read metadata before application dispatch. */
function applicationArguments(definition, args) {
  if (!definition.tool.annotations.readOnlyHint) return args;
  const applicationArgs = { ...args };
  delete applicationArgs.if_context_revision;
  return applicationArgs;
}

/** Validates the structured init surface. */
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
    APPLICATION_METHODS.some((method) => typeof application[method] !== "function") ||
    typeof application.invokeAgentTool !== "function" ||
    !Array.isArray(application.agentTools)
  ) {
    throw new Error("MCP_SERVER_INVALID: application contract incomplete");
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
    throw new Error("MCP_SERVER_INVALID: повторяющийся tool name");
  }
  const tools = Object.freeze(definitions.map(({ tool }) => tool));
  const definitionByName = new Map(definitions.map((definition) => [definition.tool.name, definition]));
  const validator = new AjvJsonSchemaValidator();
  const agentValidators = new Map(agentDefinitions.map(({ tool }) => [
    tool.name, validator.getValidator(tool.inputSchema),
  ]));
  const server = new Server(
    { name: "openspec-orchestrator", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    const definition = definitionByName.get(request.params.name);
    if (!definition) {
      return errorContent(new Error(`MCP_TOOL_NOT_FOUND: ${request.params.name}`));
    }
    try {
      if (definition.agentTool) {
        const validation = agentValidators.get(definition.tool.name)(args);
        if (!validation.valid) {
          throw new Error(`MCP_TOOL_INPUT_INVALID: ${definition.tool.name}: ${validation.errorMessage}`);
        }
      } else assertArguments(definition, args);
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

/** Starts the only supported transport: local stdio. */
export async function serveOrchestratorMcpStdio(application) {
  const server = createOrchestratorMcpServer(application);
  await server.connect(new StdioServerTransport());
  return server;
}
