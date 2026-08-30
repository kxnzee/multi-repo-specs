/** @fileoverview Immutable Cycle Record domain model. */

import { randomUUID } from "node:crypto";

import { CHANGE_TRACKING_CONTRACT, parseCycleRecordDocument } from "./contracts.js";

/** Domain representation of a validated Cycle Record v1. */
export class CycleRecord {
  #document;

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
    this.#document = Object.freeze({
      ...parsed,
      repositories: Object.freeze([...parsed.repositories]),
    });
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
    return this.#document.contract_version;
  }

  get cycleId() {
    return this.#document.cycle_id;
  }

  get changeId() {
    return this.#document.change_id;
  }

  get planningRevision() {
    return this.#document.planning_revision;
  }

  get repositories() {
    return this.#document.repositories;
  }

  get createdAt() {
    return this.#document.created_at;
  }

  /** @returns {Readonly<Record<string, unknown>>} Strict serialized Cycle Record document. */
  toDocument() {
    return this.#document;
  }
}
