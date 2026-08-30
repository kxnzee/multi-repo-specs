/** @fileoverview Public entrypoint for the OpenSpec Graph Plugin. */

import { definePlugin, REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { registerGraphCommands } from "./lib/commands.js";
import { OpenSpecGraphService } from "./lib/service.js";

const plugin = definePlugin({
  id: "openspec-graph",
  supports: [REPOSITORY_ROLE.store],
  repository: {
    connect() {
      return "OpenSpec Graph подключён; граф компилируется командами graph inspect и graph view";
    },
    status(context) {
      return new OpenSpecGraphService(context).status();
    },
  },
  registerCommands: registerGraphCommands,
});

export default plugin;
