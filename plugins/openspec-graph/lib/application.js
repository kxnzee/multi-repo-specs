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
    if (query === "node") return inspectGraphNode(report, id);
    if (query === "change_impact") return inspectChangeImpact(report, id);
    throw new Error(`GRAPH_QUERY_INVALID: ${query}`);
  }
}
