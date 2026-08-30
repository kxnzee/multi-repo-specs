/** @fileoverview Immutable Snapshot identity domain value. */

import { createHash } from "node:crypto";

import { CHANGE_TRACKING_CONTRACT } from "./contracts.js";

/** Computes one deterministic Snapshot v1 identifier from current evidence. */
export function snapshotId(cycleId, implementations) {
  const projection = {
    hash_version: CHANGE_TRACKING_CONTRACT.snapshotHashVersion,
    contract_version: CHANGE_TRACKING_CONTRACT.snapshotVersion,
    cycle_id: cycleId,
    implementations: [...implementations]
      .sort((left, right) => left.repository_id.localeCompare(right.repository_id))
      .map(({ repository_id, implementation_revision, receipt_id }) => ({
        repository_id,
        implementation_revision,
        receipt_id: receipt_id ?? null,
      })),
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(projection), "utf8")
    .digest("hex");
  return `${CHANGE_TRACKING_CONTRACT.snapshotPrefix}${digest}`;
}
