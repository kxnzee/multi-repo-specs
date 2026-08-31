/** @fileoverview Local stdio MCP transport with a fixed governed tool catalog. */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const EMPTY_SCHEMA = Object.freeze({ type: "object", additionalProperties: false });
const CHANGE_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({ change_id: Object.freeze({ type: "string" }) }),
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

export const ORCHESTRATOR_MCP_TOOLS = Object.freeze([
  Object.freeze({
    name: "get_status",
    description: "Read current Project, Repository, Plugin and Change status.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "get_setup_context",
    description: "Read exact Agent and Template choices, required Extensions and setup constraints.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "get_change_context",
    description: "Read exact OpenSpec status, artifact instructions and optional Plugin overlays.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        change_id: Object.freeze({ type: "string" }),
        artifact: Object.freeze({ type: "string" }),
      }),
      required: ["change_id"],
      additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "get_next_action",
    description: "Derive the next governed action and the actor allowed to perform it.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "get_assignment_scope",
    description: "Read all Code Repository assignments, checkouts, revisions and Graph impact.",
    inputSchema: CHANGE_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "get_doctor_report",
    description: "Run the same read-only Orchestrator Doctor used by CLI.",
    inputSchema: EMPTY_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "query_graph",
    description: "Compile the Store graph and run a report, node or Change-impact query.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        query: Object.freeze({ type: "string", enum: ["report", "node", "change_impact"] }),
        id: Object.freeze({ type: "string" }),
      }),
      required: ["query"],
      additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }),
  Object.freeze({
    name: "initialize_project",
    description: "Idempotently initialize only the MCP cwd in strict mode through Core.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        store_id: Object.freeze({ type: "string" }),
        agent_id: Object.freeze({ type: "string" }),
        template_id: Object.freeze({ type: "string" }),
        repositories: Object.freeze({
          type: "array",
          items: Object.freeze({
            type: "object",
            properties: Object.freeze({
              repository_id: Object.freeze({ type: "string" }),
              remote: Object.freeze({ type: "string" }),
              default_branch: Object.freeze({ type: "string" }),
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
  }),
  Object.freeze({
    name: "connect_project",
    description: "Idempotently connect the current strict Project; may clone registered repositories.",
    inputSchema: EMPTY_SCHEMA,
    annotations: Object.freeze({ ...WRITE_ANNOTATIONS, openWorldHint: true }),
  }),
]);

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

/** Validates the structured strict-init surface. */
function assertInitialization(args) {
  assertIdentifier(args, "store_id", { required: true });
  assertIdentifier(args, "agent_id", { required: true });
  assertIdentifier(args, "template_id");
  if (args.repositories === undefined) return;
  if (!Array.isArray(args.repositories)) {
    throw new Error("MCP_TOOL_INPUT_INVALID: repositories должен быть array");
  }
  const ids = new Set();
  for (const repository of args.repositories) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository должен быть object");
    }
    const keys = Object.keys(repository);
    if (keys.length !== 3 || keys.some((key) => !["repository_id", "remote", "default_branch"].includes(key))) {
      throw new Error("MCP_TOOL_INPUT_INVALID: repository contract несовместим");
    }
    assertIdentifier(repository, "repository_id", { required: true });
    assertString(repository, "remote", { required: true });
    assertString(repository, "default_branch", { required: true });
    if (ids.has(repository.repository_id)) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: повторяющийся repository_id ${repository.repository_id}`);
    }
    ids.add(repository.repository_id);
  }
}

/** Validates inputs even when a client ignores the advertised JSON Schema. */
function assertArguments(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} arguments должны быть object`);
  }
  const allowed = name === "query_graph" ? new Set(["query", "id"])
    : name === "get_change_context" ? new Set(["change_id", "artifact"])
      : name === "initialize_project"
        ? new Set(["store_id", "agent_id", "template_id", "repositories"])
        : ["get_doctor_report", "get_setup_context", "connect_project"].includes(name)
          ? new Set() : new Set(["change_id"]);
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`MCP_TOOL_INPUT_INVALID: ${name} не принимает ${unknown}`);
  assertString(args, "change_id", { required: name === "get_change_context" });
  assertString(args, "artifact");
  if (name === "initialize_project") assertInitialization(args);
  if (name === "query_graph") {
    if (!["report", "node", "change_impact"].includes(args.query)) {
      throw new Error("MCP_TOOL_INPUT_INVALID: query_graph.query неизвестен");
    }
    assertString(args, "id", { required: args.query !== "report" });
  }
}

/** Creates a transport-independent server for tests and stdio delivery. */
export function createOrchestratorMcpServer(application) {
  const required = [
    "getStatus",
    "getSetupContext",
    "getChangeContext",
    "getNextAction",
    "getAssignmentScope",
    "getDoctorReport",
    "queryGraph",
    "initializeProject",
    "connectProject",
    "listResources",
    "readResource",
  ];
  if (!application || required.some((method) => typeof application[method] !== "function")) {
    throw new Error("MCP_SERVER_INVALID: application contract incomplete");
  }
  const server = new Server(
    { name: "openspec-orchestrator", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ORCHESTRATOR_MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    const handlers = {
      get_status: () => application.getStatus(args),
      get_setup_context: () => application.getSetupContext(args),
      get_change_context: () => application.getChangeContext(args),
      get_next_action: () => application.getNextAction(args),
      get_assignment_scope: () => application.getAssignmentScope(args),
      get_doctor_report: () => application.getDoctorReport(args),
      query_graph: () => application.queryGraph(args),
      initialize_project: () => application.initializeProject(args),
      connect_project: () => application.connectProject(args),
    };
    const handler = handlers[request.params.name];
    if (!handler) return errorContent(new Error(`MCP_TOOL_NOT_FOUND: ${request.params.name}`));
    try {
      assertArguments(request.params.name, args);
      return resultContent(await handler());
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
