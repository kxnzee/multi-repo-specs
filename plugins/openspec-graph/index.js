/** @fileoverview Public entrypoint for the OpenSpec Graph Plugin. */

import { definePlugin, REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { openSpecGraphAgentContribution } from "./lib/agent.js";
import { registerGraphCommands } from "./lib/commands.js";
import { OpenSpecGraphService } from "./lib/service.js";

const plugin = definePlugin({
  id: "openspec-graph",
  agent: openSpecGraphAgentContribution,
  supports: [REPOSITORY_ROLE.store],
  repository: {
    connect() {
      return "OpenSpec Graph подключён; граф компилируется командами inspect и view";
    },
    status(context) {
      return new OpenSpecGraphService(context).status();
    },
  },
  registerCommands: registerGraphCommands,
});

export default plugin;
