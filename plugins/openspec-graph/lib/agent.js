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
  const assignedRepositoryIds = repositoryIds === undefined ? null : new Set(repositoryIds);
  return Object.freeze({
    ...result,
    assigned: repositoryIds === undefined
      ? null
      : currentRepository?.role === "code" && repositoryIds.includes(
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
  tools: Object.freeze([{
    name: "query_graph",
    description: "Compile the Store graph and run a report, node or Change-impact query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", enum: ["report", "node", "change_impact"] },
        id: NON_EMPTY_STRING_SCHEMA,
      },
      required: ["query"],
      additionalProperties: false,
      oneOf: [
        { properties: { query: { const: "report" } } },
        {
          properties: { query: { enum: ["node", "change_impact"] } },
          required: ["id"],
        },
      ],
    },
    annotations: READ_ONLY_ANNOTATIONS,
    validate(args) {
      if (args.query !== "report" && (typeof args.id !== "string" || args.id.length === 0)) {
        throw new Error("MCP_TOOL_INPUT_INVALID: id должен быть непустой строкой");
      }
    },
    execute(application, args) {
      return requireApplication(application).query(args.query, args.id);
    },
  }]),
});
