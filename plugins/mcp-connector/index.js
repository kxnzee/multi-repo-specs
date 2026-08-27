/** @fileoverview Public entrypoint for the declarative MCP Connector Plugin. */

import { definePlugin } from "@openspec-orch/plugin-sdk";

import { registerMcpConnectorCommands } from "./lib/commands.js";
import { McpConnectorService } from "./lib/service.js";

export { CONFIG_PATH, McpConnectorConfig, parseMcpConnectorConfig } from "./lib/config.js";
export { McpConnectorService } from "./lib/service.js";

const plugin = definePlugin({
  id: "mcp-connector",
  agent: {
    integration(context) {
      const service = new McpConnectorService(context);
      return Object.freeze({
        install() { return service.apply(); },
        remove() { return service.remove(); },
      });
    },
  },
  registerCommands: registerMcpConnectorCommands,
});

export default plugin;
