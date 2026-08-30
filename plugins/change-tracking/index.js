/** @fileoverview Public entrypoint for the Change Tracking Plugin. */

import { definePlugin, REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { registerChangeTrackingCommands } from "./lib/commands.js";
import { requireOpenSpec11 } from "./lib/openspec-compatibility.js";

/** Repository lifecycle used when Change Tracking is bound to a Store or Code Repository. */
const plugin = definePlugin({
  id: "change-tracking",
  supports: [REPOSITORY_ROLE.store, REPOSITORY_ROLE.code],
  repository: {
    async connect(context) {
      await requireOpenSpec11(context.process);
      return Object.freeze({ repositoryId: context.repository.id, state: "ready" });
    },
    async status(context) {
      await requireOpenSpec11(context.process);
      return Object.freeze({ state: "ready" });
    },
  },
  registerCommands: registerChangeTrackingCommands,
});

export default plugin;
