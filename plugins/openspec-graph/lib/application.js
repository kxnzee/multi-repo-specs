/** @fileoverview Shared OpenSpec Graph application API for CLI and machine adapters. */

import { inspectChangeImpact, inspectGraphNode } from "./query.js";
import { OpenSpecGraphService } from "./service.js";

export class OpenSpecGraphApplication {
  #service;

  constructor(context, { service = new OpenSpecGraphService(context) } = {}) {
    this.#service = service;
    Object.freeze(this);
  }

  compile() {
    return this.#service.compile();
  }

  async query(query, id) {
    const report = await this.compile();
    if (query === "report") return report;
    const result = query === "node" ? inspectGraphNode(report, id)
      : query === "change_impact" ? inspectChangeImpact(report, id) : null;
    if (result) return Object.freeze({
      ...result,
      state: report.state,
      diagnostics: report.diagnostics,
      summary: report.summary,
      ...(report.source ? { source: report.source } : {}),
    });
    throw new Error(`GRAPH_QUERY_INVALID: ${query}`);
  }
}
