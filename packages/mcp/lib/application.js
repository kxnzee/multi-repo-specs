/** @fileoverview Независимая от протокола граница приложения Agent gateway. */

const RUNTIME_METHODS = Object.freeze([
  "getStatus",
  "getSetupContext",
  "initializeProject",
  "connectProject",
  "getChangeContext",
  "getNextAction",
  "getAssignmentScope",
  "getDoctorReport",
  "invokeAgentTool",
  "listResources",
  "readResource",
]);

/** Тонкий адаптер: правила и процесс остаются в прикладных сервисах Core и плагинов. */
export class OrchestratorMcpApplication {
  #runtime;

  constructor({ runtime } = {}) {
    if (
      !runtime ||
      RUNTIME_METHODS.some((method) => typeof runtime[method] !== "function") ||
      !Array.isArray(runtime.agentTools)
    ) {
      throw new Error("MCP_APPLICATION_INVALID: контракт runtime неполон");
    }
    this.#runtime = runtime;
    Object.freeze(this);
  }

  getStatus(input = {}) { return this.#runtime.getStatus(input); }
  getSetupContext() { return this.#runtime.getSetupContext(); }
  initializeProject(input = {}) { return this.#runtime.initializeProject(input); }
  connectProject() { return this.#runtime.connectProject(); }
  getChangeContext(input = {}) { return this.#runtime.getChangeContext(input); }
  getNextAction(input = {}) { return this.#runtime.getNextAction(input); }
  getAssignmentScope(input = {}) { return this.#runtime.getAssignmentScope(input); }
  getDoctorReport(input = {}) { return this.#runtime.getDoctorReport(input); }
  listAgentTools() { return this.#runtime.listAgentTools?.() ?? this.agentTools; }
  get agentTools() { return this.#runtime.agentTools; }
  invokeAgentTool(name, input = {}) { return this.#runtime.invokeAgentTool(name, input); }
  listResources() { return this.#runtime.listResources(); }
  readResource(uri) { return this.#runtime.readResource(uri); }
}
