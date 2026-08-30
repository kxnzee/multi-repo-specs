/** @fileoverview Immutable Cycle Record domain model. */

import { randomUUID } from "node:crypto";

import { CHANGE_TRACKING_CONTRACT, parseCycleRecordDocument } from "./contracts.js";

/** Domain representation of a validated Cycle Record v1. */
export class CycleRecord {
  #contractVersion;
  #cycleId;
  #changeId;
  #planningRevision;
  #repositories;
  #createdAt;

  /**
   * @param {unknown} document Serialized Cycle Record document.
   * @param {{expectedChangeId?: string}} [options] Optional identity check for storage reads.
   */
  constructor(document, { expectedChangeId } = {}) {
    const parsed = parseCycleRecordDocument(document);
    if (expectedChangeId !== undefined && parsed.change_id !== expectedChangeId) {
      throw new Error(
        `STATE_CORRUPTED: Cycle Record содержит change_id '${parsed.change_id}', ` +
          `ожидался '${expectedChangeId}'`,
      );
    }
    this.#contractVersion = parsed.contract_version;
    this.#cycleId = parsed.cycle_id;
    this.#changeId = parsed.change_id;
    this.#planningRevision = parsed.planning_revision;
    this.#repositories = Object.freeze([...parsed.repositories]);
    this.#createdAt = parsed.created_at;
    Object.freeze(this);
  }

  /**
   * Creates a new Cycle Record using the current timestamp and a UUID v4.
   *
   * @param {{changeId: string, planningRevision: string, repositories: readonly string[]}} input Cycle values.
   * @returns {CycleRecord} Validated domain record.
   */
  static create({ changeId, planningRevision, repositories }) {
    return new CycleRecord({
      contract_version: CHANGE_TRACKING_CONTRACT.cycleRecordVersion,
      cycle_id: `${CHANGE_TRACKING_CONTRACT.cyclePrefix}${randomUUID()}`,
      change_id: changeId,
      planning_revision: planningRevision,
      repositories: [...repositories],
      created_at: new Date().toISOString(),
    });
  }

  get contractVersion() {
    return this.#contractVersion;
  }

  get cycleId() {
    return this.#cycleId;
  }

  get changeId() {
    return this.#changeId;
  }

  get planningRevision() {
    return this.#planningRevision;
  }

  get repositories() {
    return this.#repositories;
  }

  get createdAt() {
    return this.#createdAt;
  }

  /** @returns {Readonly<Record<string, unknown>>} Strict serialized Cycle Record document. */
  toDocument() {
    return Object.freeze({
      contract_version: this.#contractVersion,
      cycle_id: this.#cycleId,
      change_id: this.#changeId,
      planning_revision: this.#planningRevision,
      repositories: this.#repositories,
      created_at: this.#createdAt,
    });
  }
}
