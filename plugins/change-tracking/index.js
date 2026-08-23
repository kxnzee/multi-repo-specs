/** @fileoverview Public entrypoint for the Change Tracking Plugin. */

import { definePlugin } from "@openspec-orch/plugin-sdk";

export { CycleRecord } from "./lib/cycle-record.js";
export { CycleRecordRepository } from "./lib/cycle-record-repository.js";
export { CycleAssignmentService } from "./lib/cycle-assignment.js";
export { SnapshotIdentity, canonicalImplementations } from "./lib/snapshot-identity.js";
export { ChangeTrackingState, ChangeTrackingStore } from "./lib/state.js";

/** Repository lifecycle used when Change Tracking is bound to a Store or Code Repository. */
const plugin = definePlugin({
  id: "change-tracking",
  supports: ["store", "code"],
  repository: {
    connect(context) {
      return Object.freeze({ repositoryId: context.repository.id, state: "ready" });
    },
    status() {
      return Object.freeze({ state: "ready" });
    },
  },
});

export default plugin;
