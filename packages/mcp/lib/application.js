/** @fileoverview Protocol-independent application boundary for the Agent gateway. */

const RUNTIME_METHODS = Object.freeze([
  "getStatus",
  "getSetupContext",
  "initializeProject",
  "connectProject",
  "getChangeContext",
  "getNextAction",
  "getAssignmentScope",
  "getDoctorReport",
  "queryGraph",
  "listResources",
  "readResource",
]);

/** Maps a domain recommendation to capabilities actually present in this MCP version. */
function availableAction(value) {
  if (value?.action !== "record_result_receipt") return value;
  return Object.freeze({
    ...value,
    action: "record_result_receipt_via_cli",
    actor: "human",
    reason: "MCP не публикует Result Receipt; это человеческое действие остаётся в CLI",
  });
}

/** Thin adapter: policy and workflow remain in Core and Plugin application services. */
export class OrchestratorMcpApplication {
  #runtime;

  constructor({ runtime } = {}) {
    if (!runtime || RUNTIME_METHODS.some((method) => typeof runtime[method] !== "function")) {
      throw new Error("MCP_APPLICATION_INVALID: runtime contract incomplete");
    }
    this.#runtime = runtime;
    Object.freeze(this);
  }

  getStatus(input = {}) { return this.#runtime.getStatus(input); }
  getSetupContext() { return this.#runtime.getSetupContext(); }
  initializeProject(input = {}) { return this.#runtime.initializeProject(input); }
  connectProject() { return this.#runtime.connectProject(); }
  getChangeContext(input = {}) { return this.#runtime.getChangeContext(input); }
  async getNextAction(input = {}) {
    return availableAction(await this.#runtime.getNextAction(input));
  }
  getAssignmentScope(input = {}) { return this.#runtime.getAssignmentScope(input); }
  getDoctorReport(input = {}) { return this.#runtime.getDoctorReport(input); }
  queryGraph(input = {}) { return this.#runtime.queryGraph(input); }
  listResources() { return this.#runtime.listResources(); }
  readResource(uri) { return this.#runtime.readResource(uri); }
}
