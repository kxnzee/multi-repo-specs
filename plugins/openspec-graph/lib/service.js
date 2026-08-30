/** @fileoverview Store-scoped stateless graph compilation through PluginContext facades. */

import process from "node:process";
import { fileURLToPath } from "node:url";

import { REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { OPEN_SPEC_GRAPH_CONFIG } from "./config.js";
import { GRAPH_REPORT_CONTRACT } from "./report.js";

const launcher = fileURLToPath(new URL("../bin/openspec-graph.js", import.meta.url));

/** Parses compiler JSON without accepting malformed or partial reports. */
function parseReport(source) {
  let report;
  try {
    report = JSON.parse(source);
  } catch (error) {
    throw new Error(`OPENSPEC_GRAPH_OUTPUT_INVALID: ${error.message}`, { cause: error });
  }
  if (
    report?.report_version !== GRAPH_REPORT_CONTRACT.reportVersion
    || report?.graph_version !== GRAPH_REPORT_CONTRACT.graphVersion
    || !Object.values(GRAPH_REPORT_CONTRACT.state).includes(report.state)
    || !Array.isArray(report.nodes)
    || !Array.isArray(report.edges)
    || !Array.isArray(report.diagnostics)
    || !report.summary
  ) {
    throw new Error("OPENSPEC_GRAPH_OUTPUT_INVALID: incomplete graph report");
  }
  return report;
}

/** Adds a graph-level OpenSpec validation error without discarding the partial graph. */
function withValidationFailure(report, error) {
  const validationDiagnostic = Object.freeze({
    id: `diagnostic:${report.diagnostics.length + 1}`,
    code: "OPENSPEC_VALIDATION_FAILED",
    severity: GRAPH_REPORT_CONTRACT.severity.error,
    message: error instanceof Error ? error.message : String(error),
    elements: Object.freeze([]),
  });
  return Object.freeze({
    ...report,
    state: GRAPH_REPORT_CONTRACT.state.invalid,
    diagnostics: Object.freeze([...report.diagnostics, validationDiagnostic]),
    summary: Object.freeze({
      ...report.summary,
      errors: report.summary.errors + 1,
    }),
  });
}

/** Owns deterministic on-demand compilation without Plugin storage. */
export class OpenSpecGraphService {
  #context;

  constructor(context) {
    this.#context = context;
    Object.freeze(this);
  }

  /** Compiles the current Store and folds strict OpenSpec validation into diagnostics. */
  async compile() {
    const report = await this.#project();
    try {
      await this.#context.process.run(
        "openspec",
        ["validate", "--all", "--strict", "--no-interactive", "--json"],
      );
      return report;
    } catch (error) {
      return withValidationFailure(report, error);
    }
  }

  /** Reports only the stateless Plugin lifecycle; graph health belongs to graph inspect. */
  status() {
    return Object.freeze({
      state: GRAPH_REPORT_CONTRACT.state.ready,
      details: JSON.stringify(OPEN_SPEC_GRAPH_CONFIG.lifecycle),
    });
  }

  async #project() {
    const repositories = this.#context.project.repositories
      .filter(({ role }) => role === REPOSITORY_ROLE.code)
      .map(({ id, role }) => ({ id, role }));
    const output = await this.#context.process.run(
      process.execPath,
      [
        launcher,
        "compile",
        ".",
        "--store-id",
        this.#context.project.id,
        "--repositories-json",
        JSON.stringify(repositories),
      ],
    );
    return parseReport(output);
  }
}
