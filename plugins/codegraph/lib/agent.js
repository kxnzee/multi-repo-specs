/** @fileoverview Repository-scoped CodeGraph tool for the shared Agent gateway. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { CodeGraphRepositoryStatus } from "./repository.js";

const launcher = fileURLToPath(new URL("../bin/codegraph.js", import.meta.url));
const NON_EMPTY_STRING_SCHEMA = Object.freeze({ type: "string", minLength: 1 });
const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/** Reads one bound Repository through the package-owned CodeGraph runtime. */
class CodeGraphAgentApplication {
  #context;

  constructor(context) {
    this.#context = context;
    Object.freeze(this);
  }

  async explore(query) {
    const details = await this.#context.process.run(
      process.execPath,
      [launcher, "status", ".", "--json"],
    );
    const { state } = new CodeGraphRepositoryStatus(details).toPluginStatus();
    if (state !== "ready") {
      throw new Error(
        `CODEGRAPH_INDEX_${state.toUpperCase()}: ${this.#context.repository.id}; ` +
        "run plugin status and sync explicitly before retrying",
      );
    }
    return this.#context.process.run(
      process.execPath,
      [launcher, "explore", "--", query.trim()],
    );
  }
}

/** Requires the runtime-selected Repository application. */
function requireApplication(application) {
  if (application) return application;
  throw new Error("CAPABILITY_UNAVAILABLE: codegraph is not connected to the selected Repository");
}

/** Validates the direct Plugin handler boundary in addition to MCP JSON Schema. */
function validateExploreInput(input) {
  for (const field of ["repository_id", "query"]) {
    if (typeof input?.[field] !== "string" || input[field].trim().length === 0) {
      throw new Error(`MCP_TOOL_INPUT_INVALID: ${field} должен быть непустой строкой`);
    }
  }
}

export const codeGraphAgentContribution = Object.freeze({
  requireBinding: true,
  create: (context) => new CodeGraphAgentApplication(context),
  tools: Object.freeze([Object.freeze({
    name: "codegraph_explore",
    repositoryParameter: "repository_id",
    description: "Read relevant source and call paths from one connected Repository. " +
      "Use this as the first source-code read when the selected Repository has a CodeGraph index. " +
      "Copy repository_id from assignment_scope and put one concrete question plus exact paths or symbols in query. " +
      "The gateway resolves the bound checkout; filesystem paths are not accepted. " +
      "If the index is stale or unavailable, stop and follow the active fallback rules; never sync automatically.",
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        repository_id: Object.freeze({
          ...NON_EMPTY_STRING_SCHEMA,
          description: "Exact connected Repository ID; for workflow evidence copy it from assignment_scope. " +
            "This is not a checkout path.",
        }),
        query: Object.freeze({
          ...NON_EMPTY_STRING_SCHEMA,
          description: "One current-state question including the exact paths or symbols that anchor the search.",
        }),
      }),
      required: Object.freeze(["repository_id", "query"]),
      additionalProperties: false,
    }),
    annotations: READ_ONLY_ANNOTATIONS,
    validate: validateExploreInput,
    execute(application, input) {
      return requireApplication(application).explore(input.query);
    },
  })]),
});
