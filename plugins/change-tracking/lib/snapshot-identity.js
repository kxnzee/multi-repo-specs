/** @fileoverview Immutable Snapshot identity domain value. */

import { createHash } from "node:crypto";

import { CHANGE_TRACKING_CONTRACT } from "./contracts.js";

/**
 * Produces the frozen canonical Snapshot implementation projection.
 *
 * @param {readonly {repository_id: string, implementation_revision: string}[]} implementations Repository revisions.
 * @returns {readonly Readonly<{repository_id: string, implementation_revision: string}>[]} Canonical projection.
 */
export function canonicalImplementations(implementations) {
  return Object.freeze(
    [...implementations]
      .sort((left, right) => left.repository_id.localeCompare(right.repository_id))
      .map(({ repository_id, implementation_revision }) => Object.freeze({
        repository_id,
        implementation_revision,
      })),
  );
}

/** Snapshot v1 identifier computed from a frozen canonical projection. */
export class SnapshotIdentity {
  #value;

  /**
   * @param {string} cycleId Cycle identifier.
   * @param {readonly {repository_id: string, implementation_revision: string}[]} implementations Repository revisions.
   */
  constructor(cycleId, implementations) {
    const projection = {
      hash_version: CHANGE_TRACKING_CONTRACT.snapshotHashVersion,
      contract_version: CHANGE_TRACKING_CONTRACT.snapshotVersion,
      cycle_id: cycleId,
      implementations: canonicalImplementations(implementations),
    };
    const digest = createHash("sha256")
      .update(JSON.stringify(projection), "utf8")
      .digest("hex");
    this.#value = `${CHANGE_TRACKING_CONTRACT.snapshotPrefix}${digest}`;
    Object.freeze(this);
  }

  get value() {
    return this.#value;
  }

  toString() {
    return this.#value;
  }
}
