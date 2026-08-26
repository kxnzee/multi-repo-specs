/** @fileoverview Public entrypoint for the OpenSpec Graph Plugin. */

import { definePlugin } from "@openspec-orch/plugin-sdk";

import { registerGraphCommands } from "./lib/commands.js";
import { OpenSpecGraphService } from "./lib/service.js";

const plugin = definePlugin({
  id: "openspec-graph",
  supports: ["store"],
  repository: {
    connect() {
      return "OpenSpec Graph подключён; выполните openspec-orch graph build";
    },
    async status(context) {
      return new OpenSpecGraphService(context).status();
    },
    async sync(context) {
      const graph = await new OpenSpecGraphService(context).build();
      return OpenSpecGraphService.summary(graph);
    },
  },
  registerCommands: registerGraphCommands,
});

export default plugin;
