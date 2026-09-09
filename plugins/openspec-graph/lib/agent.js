/** @fileoverview Plugin-owned Agent tool and governed response overlays. */

import { OpenSpecGraphApplication } from "./application.js";

const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: "string", minLength: 1 });
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Fails one direct graph query when the Store has no available binding. */
function requireApplication(application) {
  if (application) return application;
  throw new Error(
    "CAPABILITY_UNAVAILABLE: openspec-graph is not connected or unavailable; inspect Doctor",
  );
}

/** Adds the optional Graph capability without changing other Plugin capabilities. */
function enhanceStatus(result, application) {
  return Object.freeze({
    ...result,
    capabilities: Object.freeze({
      ...result.capabilities,
      graph: Object.freeze({
        provider: "openspec-graph",
        available: application !== null,
        ...(application === null ? {
          reason: "Plugin is not connected or unavailable; inspect Doctor",
        } : {}),
      }),
    }),
  });
}

/** Projects one already-resolved Graph impact onto generic assignment data. */
function projectAssignmentScope(result, graphImpact, currentRepository) {
  const repositoryIds = graphImpact?.repositories.map(({ id }) => id.replace(/^repository:/u, ""));
  const invalidImpact = graphImpact?.diagnostics?.some(({ code, source }) => (
    (code.startsWith("REPOSITORY_IMPACT_") || code === "GRAPH_UNKNOWN_REPOSITORY")
    && source?.path === `${graphImpact.change?.path}/proposal.md`
  ));
  const assignedRepositoryIds = repositoryIds?.length && !invalidImpact
    ? new Set(repositoryIds) : null;
  return Object.freeze({
    ...result,
    assigned: assignedRepositoryIds === null
      ? null
      : currentRepository?.role === "code" && assignedRepositoryIds.has(
        currentRepository.repository_id,
      ),
    assignments: Object.freeze(result.assignments.map((assignment) => Object.freeze({
      ...assignment,
      assigned: assignedRepositoryIds?.has(assignment.repository_id) ?? null,
    }))),
  });
}

/** Adds current Change impact and reuses it for an embedded assignment scope. */
async function enhanceChangeContext(result, application, input) {
  const graphImpact = application ? await application.query("change_impact", input.change_id) : null;
  return Object.freeze({
    ...result,
    graph_impact: graphImpact,
    ...(result.assignment_scope ? {
      assignment_scope: projectAssignmentScope(
        result.assignment_scope,
        graphImpact,
        result.current_repository,
      ),
    } : {}),
  });
}

/** Projects Graph repositories onto the generic assignment response. */
async function enhanceAssignmentScope(result, application, input) {
  const graphImpact = application && input.change_id
    ? await application.query("change_impact", input.change_id)
    : null;
  return Object.freeze({
    ...projectAssignmentScope(result, graphImpact, result.current_repository),
    graph_impact: graphImpact,
  });
}

export const openSpecGraphAgentContribution = Object.freeze({
  requireBinding: true,
  create: (context) => new OpenSpecGraphApplication(context),
  async enhance({ application, input, operation, result }) {
    if (operation === "getStatus") return enhanceStatus(result, application);
    if (operation === "getChangeContext") {
      return enhanceChangeContext(result, application, input);
    }
    if (operation === "getAssignmentScope") {
      return enhanceAssignmentScope(result, application, input);
    }
    return result;
  },
  tools: Object.freeze([
    graphTool("get_spec_graph", "report", null,
      "Read the complete OpenSpec graph: specs, Changes, repositories, relationships and diagnostics."),
    graphTool("get_spec_graph_node", "node", "node_id",
      "Read one OpenSpec graph node, its edges and neighbors. Copy node_id from get_spec_graph.nodes[].id."),
    graphTool("get_spec_change_impact", "change_impact", "change_id",
      "Read the specs and repositories affected by one OpenSpec Change and the supporting relationships."),
  ]),
});

/** Keeps each public operation's inputs explicit while sharing Store selection. */
function graphTool(name, operation, identifier, description) {
  return Object.freeze({
    name,
    repositoryParameter: "store_repository_id",
    description: description + " Reads the main Store by default, including when invoked from a Code Repository. " +
      "For another Store, select its local store/specs repository ID from get_status.project.repositories.",
    inputSchema: {
      type: "object",
      properties: {
        store_repository_id: {
          ...NON_EMPTY_STRING_SCHEMA,
          description: "Optional Store checkout to read. Copy repository_id from get_status.project.repositories " +
            "with role store or specs and plugin openspec-graph. Omit for the main Store. " +
            "This is the local registry ID, not the nested store_id, a code repository ID, or a graph filter.",
        },
        ...(identifier ? { [identifier]: {
          ...NON_EMPTY_STRING_SCHEMA,
          description: identifier === "node_id"
            ? "Exact graph nodes[].id including its type prefix, e.g. master-spec:shipping-cost or repository:shop."
            : "Exact graph nodes[].change_id: active directory name or archive/YYYY-MM-DD-name; without the change: graph-node prefix.",
        } } : {}),
      },
      required: identifier ? [identifier] : [],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    validate(args) {
      for (const field of ["store_repository_id", ...(identifier ? [identifier] : [])]) {
        if (field === "store_repository_id" && args[field] === undefined) continue;
        if (typeof args[field] !== "string" || args[field].trim().length === 0) {
          throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть непустой строкой`);
        }
      }
    },
    execute(application, args) {
      return requireApplication(application).query(operation, identifier ? args[identifier] : undefined);
    },
  });
}
