/** @fileoverview Public entrypoint for the Change Tracking Plugin. */

import { definePlugin, REPOSITORY_ROLE } from "@openspec-orch/plugin-sdk";

import { registerChangeTrackingCommands } from "./lib/commands.js";

export { CycleRecord } from "./lib/cycle-record.js";
export { CycleRecordRepository } from "./lib/cycle-record-repository.js";
export { ChangeTrackingService } from "./lib/service.js";
export { SnapshotIdentity, canonicalImplementations } from "./lib/snapshot-identity.js";
export { ChangeTrackingState, ChangeTrackingStore } from "./lib/state.js";

/** Repository lifecycle used when Change Tracking is bound to a Store or Code Repository. */
const plugin = definePlugin({
  id: "change-tracking",
  supports: [REPOSITORY_ROLE.store, REPOSITORY_ROLE.code],
  extensions(context) {
    if (context.repository.role !== REPOSITORY_ROLE.store) return [];
    return [{
      id: "agent",
      root: "./extension",
      target: context.repository,
    }];
  },
  repository: {
    connect(context) {
      return Object.freeze({ repositoryId: context.repository.id, state: "ready" });
    },
    status() {
      return Object.freeze({ state: "ready" });
    },
  },
  registerCommands: registerChangeTrackingCommands,
});

export default plugin;
