/** @fileoverview Публичная точка входа встроенного MCP-адаптера Orchestrator. */

export { OrchestratorMcpApplication } from "./lib/application.js";
export { StoreResourceService } from "./lib/resources.js";
export {
  ORCHESTRATOR_MCP_TOOLS,
  createOrchestratorMcpServer,
  serveOrchestratorMcpStdio,
} from "./lib/server.js";
